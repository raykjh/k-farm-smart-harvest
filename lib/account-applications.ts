import {randomUUID} from 'node:crypto';
import {knownCenter} from './center-registry';
import {z} from 'zod';
import {db} from './db';
import {accountSchema,accountBirthSchema,accountPhoneSchema,authKey,lockAccountActor,passwordHash,publicUser,type Principal,type User} from './auth';
import {AccountChangeError} from './account-management';
import {newPasswordSchema} from './password-policy';
export const applicationSchema=z.object({
 username:accountSchema.shape.username,name:accountSchema.shape.name,
 birth:accountBirthSchema,
 affiliation:z.string().trim().min(1).max(100),phone:accountPhoneSchema,password:newPasswordSchema,
}).strict();
export type AccountApplication=Omit<z.infer<typeof applicationSchema>,'password'>&{id:string;passwordHash:string;status:'PENDING'|'APPROVED'|'REJECTED';createdAt:string;approvedBy?:string;approvedAt?:string;userId?:string;rejectedBy?:string;rejectedAt?:string;rejectionReason?:string};
export const publicApplication=({passwordHash:_,...value}:AccountApplication)=>value;
export async function submitApplication(input:unknown){
 const b=applicationSchema.parse(input);
 // Limit hashing/storage work on this local public endpoint without accepting a client identity.
 const allowed=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:signup-limit'))`;
  const key=authKey('signupLimit','public'),record=await tx.workRecord.findUnique({where:{workspace_kind_id:key}}),old=record?.payload as any,now=Date.now();
  const value=old&&old.until>now?old:{count:0,until:now+15*60000};if(value.count>=30)return false;value.count++;
  await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload:value},update:{payload:value}});return true;
 });if(!allowed)throw Error('가입 신청이 많습니다. 잠시 후 다시 시도하세요.');
 const hash=await passwordHash(b.password);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:accounts'))`;
  const records=await tx.workRecord.findMany({where:{workspace:'auth',kind:{in:['user','application']}}});
  if(records.some(r=>(r.payload as {username:string}).username===b.username&&(r.kind==='user'||(r.payload as AccountApplication).status!=='REJECTED')))throw Error('사용 중이거나 이미 신청된 아이디입니다.');
  const {password:_,...profile}=b;
  const value:AccountApplication={...profile,id:randomUUID(),passwordHash:hash,status:'PENDING',createdAt:new Date().toISOString()};
  await tx.workRecord.create({data:{...authKey('application',value.id),payload:value}});
  // No user, session or privileges are created before approval.
  return {ok:true,status:'PENDING'};
 });
}
export async function approveApplication(principal:Principal,input:unknown){
 if(principal.role!=='SUPER_ADMIN'||principal.mustChangePassword)throw Error('총괄관리자 승인 권한이 필요합니다.');
 const b=z.object({id:z.string().uuid(),role:z.enum(['CENTER_ADMIN','CENTER_STAFF']),centerId:z.string().refine(knownCenter),expectedVersion:z.number().int().positive().optional()}).strict().parse(input);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:accounts'))`;
  const actor=await lockAccountActor(tx,principal);if(actor.role!=='SUPER_ADMIN')throw Error('승인 권한을 다시 확인하세요.');
  const key=authKey('application',b.id),row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),application=row.payload as AccountApplication;
  if(application.status!=='PENDING'||b.expectedVersion!==undefined&&b.expectedVersion!==row.version)throw new AccountChangeError('이미 변경 또는 처리된 신청입니다. 목록을 새로고침하세요.',409);
  const users=await tx.workRecord.findMany({where:{workspace:'auth',kind:'user'}});
  if(users.some(u=>(u.payload as User).username===application.username))throw Error('이미 사용 중인 아이디입니다.');
  const user:User={id:randomUUID(),username:application.username,name:application.name,birth:application.birth,phone:application.phone,passwordHash:application.passwordHash,role:b.role,centerId:b.centerId,enabled:true,mustChangePassword:false,credentialVersion:0};
  await tx.workRecord.create({data:{...authKey('user',user.id),payload:user}});
  await tx.workRecord.update({where:{workspace_kind_id:key},data:{payload:{...application,passwordHash:'',status:'APPROVED',approvedBy:principal.id,approvedAt:new Date().toISOString(),userId:user.id},version:{increment:1}}});
  await tx.audit.create({data:{centerId:b.centerId,action:'account.applicationApproved',detail:{actorId:principal.id,userId:user.id,applicationId:b.id,role:b.role}}});
  return publicUser(user);
 });
}
export async function rejectApplication(principal:Principal,input:unknown){
 if(principal.role!=='SUPER_ADMIN'||principal.mustChangePassword)throw new AccountChangeError('총괄관리자 권한이 필요합니다.',403);
 const b=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().max(500).default('')}).strict().parse(input);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:accounts'))`;
  const actor=await lockAccountActor(tx,principal);if(actor.role!=='SUPER_ADMIN')throw new AccountChangeError('총괄관리자 권한이 필요합니다.',403);
  const key=authKey('application',b.id),row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),a=row.payload as AccountApplication;
  if(a.status!=='PENDING'||row.version!==b.expectedVersion)throw new AccountChangeError('이미 변경 또는 처리된 신청입니다. 목록을 새로고침하세요.',409);
  await tx.workRecord.update({where:{workspace_kind_id:key},data:{payload:{...a,status:'REJECTED',passwordHash:'',rejectedBy:actor.id,rejectedAt:new Date().toISOString(),rejectionReason:b.reason},version:{increment:1}}});
  await tx.audit.create({data:{centerId:'global',action:'account.applicationRejected',detail:{actorId:actor.id,applicationId:a.id}}});
  return {ok:true};
 });
}
