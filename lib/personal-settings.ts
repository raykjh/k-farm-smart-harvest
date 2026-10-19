import {z} from 'zod';
import {db} from './db';
import {accountSchema,authKey,publicUser,type Principal,type User} from './auth';
import type {Prisma} from '@prisma/client';
const profile=accountSchema.pick({name:true,birth:true,phone:true}).required().strict();
const input=z.object({expectedVersion:z.number().int().positive(),profile}).strict();
async function currentUser(tx:Prisma.TransactionClient,p:Principal){
 if(p.judgeAccount)throw Error('Public trial account settings cannot be changed.');
 await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace='auth' AND kind='user' AND id=${p.id} FOR UPDATE`;
 const row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',p.id)}}),u=row.payload as User;
 if(u.judgeAccount||!u.enabled||u.deletedAt||u.mustChangePassword||(u.credentialVersion??0)!==(p.credentialVersion??0)||u.role!==p.role||u.centerId!==p.centerId)throw Error('다시 로그인해주세요.');
 return {row,u};
}
export async function personalSettings(p:Principal){
 const row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',p.id)}});
 const request=await db.workRecord.findUnique({where:{workspace_kind_id:authKey('recoveryRequest',p.id)}});
 return {user:publicUser(row.payload as User),recordVersion:row.version,recoveryRequest:request?.payload??null};
}
export async function savePersonalProfile(p:Principal,raw:unknown){
 const b=input.parse(raw);
 return db.$transaction(async tx=>{
  const {row,u}=await currentUser(tx,p);
  if(row.version!==b.expectedVersion)throw Error('담당자 정보가 변경되었습니다. 다시 불러와주세요.');
  const saved=await tx.workRecord.update({where:{workspace_kind_id:authKey('user',p.id)},data:{payload:{...u,...b.profile},version:{increment:1}}});
  await tx.audit.create({data:{centerId:u.centerId??'global',action:'account.profileChanged',detail:{actorId:u.id,fromVersion:row.version,toVersion:saved.version}}});
  return {user:publicUser(saved.payload as User),recordVersion:saved.version};
 });
}
export async function requestPasswordRecovery(p:Principal){
 return db.$transaction(async tx=>{
  const {u}=await currentUser(tx,p);
  if(u.role==='SUPER_ADMIN')throw Error('총괄 계정은 보관한 일회성 복구 코드를 이용해주세요.');
  const key=authKey('recoveryRequest',u.id),old=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  if((old?.payload as any)?.status==='PENDING')return {request:old!.payload,alreadyRequested:true};
  const request={userId:u.id,status:'PENDING',requestedAt:new Date().toISOString()};
  await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload:request},update:{payload:request,version:{increment:1}}});
  await tx.audit.create({data:{centerId:u.centerId??'global',action:'account.recoveryRequested',detail:{actorId:u.id}}});
  return {request,alreadyRequested:false};
 });
}
