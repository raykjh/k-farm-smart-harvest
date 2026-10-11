import {randomUUID} from 'node:crypto';
import {knownCenter} from './center-registry';
import {z} from 'zod';
import {db} from './db';
import {accountSchema,authKey,passwordHash,publicUser,type Principal,type User} from './auth';
import {newPasswordSchema} from './password-policy';
export const applicationSchema=z.object({
 username:accountSchema.shape.username,name:accountSchema.shape.name,
 birth:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v&&d.getTime()<Date.now()},'생년월일을 확인하세요.'),
 affiliation:z.string().trim().min(1).max(100),phone:z.string().trim().regex(/^[0-9+() -]{8,30}$/,'연락처를 확인하세요.'),password:newPasswordSchema,
}).strict();
export type AccountApplication=Omit<z.infer<typeof applicationSchema>,'password'>&{id:string;passwordHash:string;status:'PENDING'|'APPROVED';createdAt:string;approvedBy?:string;approvedAt?:string;userId?:string};
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
  if(records.some(r=>(r.payload as {username:string}).username===b.username))throw Error('사용 중이거나 이미 신청된 아이디입니다.');
  const {password:_,...profile}=b;
  const value:AccountApplication={...profile,id:randomUUID(),passwordHash:hash,status:'PENDING',createdAt:new Date().toISOString()};
  await tx.workRecord.create({data:{...authKey('application',value.id),payload:value}});
  // No user, session or privileges are created before approval.
  return {ok:true,status:'PENDING'};
 });
}
export async function approveApplication(principal:Principal,input:unknown){
 if(principal.role!=='SUPER_ADMIN'||principal.mustChangePassword)throw Error('총괄관리자 승인 권한이 필요합니다.');
 const b=z.object({id:z.string().uuid(),role:z.enum(['CENTER_ADMIN','CENTER_STAFF']),centerId:z.string().refine(knownCenter)}).strict().parse(input);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:accounts'))`;
  const actor=(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',principal.id)}})).payload as User;
  if(!actor.enabled||actor.role!=='SUPER_ADMIN'||actor.mustChangePassword||(actor.credentialVersion??0)!==(principal.credentialVersion??0))throw Error('승인 권한을 다시 확인하세요.');
  const key=authKey('application',b.id),application=(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}})).payload as AccountApplication;
  if(application.status!=='PENDING')throw Error('이미 처리된 신청입니다.');
  const users=await tx.workRecord.findMany({where:{workspace:'auth',kind:'user'}});
  if(users.some(u=>(u.payload as User).username===application.username))throw Error('이미 사용 중인 아이디입니다.');
  const user:User={id:randomUUID(),username:application.username,name:application.name,passwordHash:application.passwordHash,role:b.role,centerId:b.centerId,enabled:true,mustChangePassword:false,credentialVersion:0};
  await tx.workRecord.create({data:{...authKey('user',user.id),payload:user}});
  await tx.workRecord.update({where:{workspace_kind_id:key},data:{payload:{...application,passwordHash:'',status:'APPROVED',approvedBy:principal.id,approvedAt:new Date().toISOString(),userId:user.id},version:{increment:1}}});
  await tx.audit.create({data:{centerId:b.centerId,action:'account.applicationApproved',detail:{actorId:principal.id,userId:user.id,applicationId:b.id,role:b.role}}});
  return publicUser(user);
 });
}
