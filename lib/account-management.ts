import {z} from 'zod';
import {db} from './db';
import {knownCenter} from './center-registry';
import {accountSchema,authKey,lockAccountActor,passwordHash,publicUser,type Principal,type User} from './auth';
import {newPasswordSchema} from './password-policy';

export class AccountChangeError extends Error {
 constructor(message:string,readonly status:number){super(message)}
}
const version=z.number().int().positive();
const identity={id:z.string().uuid(),expectedVersion:version.optional()};
const profileSchema=accountSchema.pick({name:true,role:true,centerId:true,birth:true,phone:true}).extend({enabled:z.boolean()}).strict();
const changeSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('update'),...identity,expectedVersion:version,profile:profileSchema}).strict(),
 z.object({action:z.literal('delete'),...identity,expectedVersion:version}).strict(),
 z.object({action:z.literal('disable'),...identity}).strict(),
 z.object({action:z.literal('resetPassword'),...identity,password:newPasswordSchema}).strict(),
]);
export async function changeAccount(principal:Principal,input:unknown){
 const b=changeSchema.parse(input);
 if(!['SUPER_ADMIN','CENTER_ADMIN'].includes(principal.role)||principal.mustChangePassword)throw new AccountChangeError('계정 관리 권한이 없습니다.',403);
 const resetHash=b.action==='resetPassword'?await passwordHash(b.password):null;
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:accounts'))`;
  const actor=await lockAccountActor(tx,principal);
  await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace='auth' AND kind='user' AND id=${b.id} FOR UPDATE`;
  const key=authKey('user',b.id),row=await tx.workRecord.findUnique({where:{workspace_kind_id:key}}),target=row?.payload as User|undefined;
  if(!row||!target||target.deletedAt)throw new AccountChangeError('계정을 찾을 수 없습니다.',404);
  const self=actor.id===target.id;
  if(!(actor.role==='SUPER_ADMIN'||actor.role==='CENTER_ADMIN'&&knownCenter(actor.centerId)&&target.role==='CENTER_STAFF'&&target.centerId===actor.centerId||self&&b.action==='update'))throw new AccountChangeError('이 계정을 관리할 권한이 없습니다.',403);
  if(b.expectedVersion!==undefined&&b.expectedVersion!==row.version)throw new AccountChangeError('다른 담당자가 변경한 계정입니다. 목록을 새로고침한 뒤 다시 확인하세요.',409);
  let updated:User;
  let revoke=false;
  if(b.action==='update'){
   const p=b.profile;
   if(p.role==='SUPER_ADMIN'?p.centerId!==null:!knownCenter(p.centerId))throw new AccountChangeError('소속 센터를 확인하세요.',400);
   if(self&&(p.role!==target.role||p.centerId!==target.centerId||p.enabled!==target.enabled))throw new AccountChangeError('본인의 권한·소속·사용 상태는 변경할 수 없습니다.',403);
   if(!self&&actor.role==='CENTER_ADMIN'&&(p.role!=='CENTER_STAFF'||p.centerId!==actor.centerId))throw new AccountChangeError('담당 센터의 담당자 계정만 수정할 수 있습니다.',403);
   revoke=p.role!==target.role||p.centerId!==target.centerId||p.enabled!==target.enabled;
   updated={...target,...p,credentialVersion:(target.credentialVersion??0)+(revoke?1:0)};
  }else{
   if(self)throw new AccountChangeError('본인 계정은 여기서 삭제·중지·비밀번호 재설정할 수 없습니다.',403);
   revoke=true;
   updated=b.action==='resetPassword'?{...target,passwordHash:resetHash!,mustChangePassword:true,credentialVersion:(target.credentialVersion??0)+1}:
    {...target,enabled:false,credentialVersion:(target.credentialVersion??0)+1,...(b.action==='delete'?{deletedAt:new Date().toISOString(),deletedBy:actor.id,passwordHash:''}:{})};
  }
  if(target.role==='SUPER_ADMIN'&&target.enabled&&(updated.role!=='SUPER_ADMIN'||!updated.enabled)){
   const admins=await tx.workRecord.findMany({where:{workspace:'auth',kind:'user'}});
   if(!admins.some(r=>{const u=r.payload as User;return u.id!==target.id&&u.role==='SUPER_ADMIN'&&u.enabled&&!u.deletedAt}))throw new AccountChangeError('사용 가능한 총괄 관리자 계정은 최소 한 개 있어야 합니다.',409);
  }
  const saved=await tx.workRecord.update({where:{workspace_kind_id:key},data:{payload:updated,version:{increment:1}}});
  if(b.action==='resetPassword'){
   const request=await tx.workRecord.findUnique({where:{workspace_kind_id:authKey('recoveryRequest',target.id)}});
   if(request&&(request.payload as any).status==='PENDING')await tx.workRecord.update({where:{workspace_kind_id:authKey('recoveryRequest',target.id)},data:{payload:{...request.payload as object,status:'RESOLVED',resolvedAt:new Date().toISOString(),resolvedBy:actor.id},version:{increment:1}}});
  }
  if(revoke){
   await tx.workRecord.deleteMany({where:{workspace:'auth',kind:'session',payload:{path:['userId'],equals:target.id}}});
   await tx.workRecord.deleteMany({where:authKey('recovery',target.id)});
  }
  await tx.audit.create({data:{centerId:target.centerId??'global',action:b.action==='resetPassword'?'account.passwordReset':`account.${b.action}`,detail:{actorId:actor.id,userId:target.id,fromVersion:row.version,toVersion:saved.version,previousRole:target.role,role:updated.role,previousCenterId:target.centerId,centerId:updated.centerId}}});
  return {ok:true,user:{...publicUser(updated),recordVersion:saved.version}};
 });
}
