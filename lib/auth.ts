import {newPasswordSchema} from './password-policy';
import {knownCenter} from './center-registry';
import {judgeAccountEnabled} from './judge-access-config';
import {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {db} from './db';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
const derive=(password:string,salt:string,length:number)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,length,{N:131072,r:8,p:1,maxmem:256*1024*1024},(error,key)=>error?reject(error):resolve(key)));
export const AUTH_COOKIE='kfarm_session';
export const ACTIVE_CENTER='demo';
export type Role='SUPER_ADMIN'|'CENTER_ADMIN'|'CENTER_STAFF';
export type User={id:string;username:string;name:string;role:Role;centerId:string|null;enabled:boolean;passwordHash:string;mustChangePassword?:boolean;credentialVersion?:number;birth?:string;phone?:string;deletedAt?:string;deletedBy?:string;judgeAccount?:true};
export type Principal=Omit<User,'passwordHash'>;
const context=new AsyncLocalStorage<Principal>();
export const asPrincipal=<T>(p:Principal,fn:()=>T)=>context.run(p,fn);
export const currentPrincipal=()=>context.getStore();
export const actorLabel=()=>{const p=currentPrincipal();if(!p)throw Error('로그인이 필요합니다.');return `${p.name} [${p.id}]`};
export const authKey=(kind:string,id:string)=>({workspace:'auth',kind,id});
export const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
export const publicUser=({passwordHash:_,...u}:User):Principal=>u;
export const accountBirthSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v&&d.getTime()<Date.now()},'생년월일을 확인하세요.');
export const accountPhoneSchema=z.string().trim().regex(/^[0-9+() -]{8,30}$/,'연락처를 확인하세요.');
export const accountSchema=z.object({username:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.@-]{2,99}$/),name:z.string().trim().min(1).max(60),password:newPasswordSchema,role:z.enum(['SUPER_ADMIN','CENTER_ADMIN','CENTER_STAFF']),centerId:z.string().max(100).nullable(),birth:z.union([accountBirthSchema,z.literal('')]).optional(),phone:z.union([accountPhoneSchema,z.literal('')]).optional()}).strict();
// Call under auth:accounts. Recheck authority inside the same transaction as a change.
export async function lockAccountActor(tx:Prisma.TransactionClient,principal:Principal){
 if(principal.judgeAccount)throw Error('Public trial accounts cannot manage accounts.');
 await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace='auth' AND kind='user' AND id=${principal.id} FOR UPDATE`;
 const row=await tx.workRecord.findUnique({where:{workspace_kind_id:authKey('user',principal.id)}}),actor=row?.payload as User|undefined;
 if(!actor||actor.judgeAccount||!actor.enabled||actor.deletedAt||actor.mustChangePassword||actor.role!==principal.role||actor.centerId!==principal.centerId||(actor.credentialVersion??0)!==(principal.credentialVersion??0)||!['SUPER_ADMIN','CENTER_ADMIN'].includes(actor.role))throw Error('계정 관리 권한이 변경되었습니다. 다시 로그인하세요.');
 return actor;
}
export async function passwordHash(password:string){const salt=randomBytes(16).toString('hex');const key=await derive(password,salt,64) as Buffer;return `scrypt:${salt}:${key.toString('hex')}`;}
export async function passwordMatches(password:string,hash:string){const [algorithm,salt,key]=hash.split(':');if(algorithm!=='scrypt'||!salt||!key)return false;const actual=await derive(password,salt,64) as Buffer;const expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export function sessionToken(req:Request){return req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(AUTH_COOKIE+'='))?.slice(AUTH_COOKIE.length+1)??'';}
export async function authenticate(req:Request):Promise<Principal|null>{
 const token=sessionToken(req);if(!/^[a-f0-9]{64}$/.test(token))return null;
 const record=await db.workRecord.findUnique({where:{workspace_kind_id:authKey('session',digest(token))}});const session=record?.payload as any;
 if(!session||session.expiresAt<=Date.now())return null;
 const row=await db.workRecord.findUnique({where:{workspace_kind_id:authKey('user',session.userId)}});const u=row?.payload as User|undefined;
 return u?.enabled&&!u.deletedAt&&judgeAccountEnabled(u)&&(session.credentialVersion??0)===(u.credentialVersion??0)?publicUser(u):null;
}
export async function createSession(userId:string,expectedVersion?:number){const row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',userId)}});const user=row.payload as User;const credentialVersion=expectedVersion??user.credentialVersion??0;const token=randomBytes(32).toString('hex');await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId,credentialVersion,expiresAt:Date.now()+8*3600000}}});return token;}
export async function login(username:string,password:string){
 const id=digest(username.toLowerCase()),now=Date.now();
 // Persisted per-account throttle. Reserve an attempt before expensive password verification.
 const allowed=await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`login:${id}`}))`;const row=await tx.workRecord.findUnique({where:{workspace_kind_id:authKey('loginLimit',id)}});const old=row?.payload as any;const value=old&&old.until>now?old:{count:0,until:now+15*60000};if(value.count>=5)return false;value.count++;await tx.workRecord.upsert({where:{workspace_kind_id:authKey('loginLimit',id)},create:{...authKey('loginLimit',id),payload:value},update:{payload:value}});return true;});
 if(!allowed)throw Error('로그인 시도 제한입니다. 15분 후 다시 시도하세요.');
 const rows=await db.workRecord.findMany({where:{workspace:'auth',kind:'user'}});const u=rows.map(r=>r.payload as User).find(u=>u.username===username.toLowerCase());
 const valid=await passwordMatches(password,u?.passwordHash??`scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`);
 if(!u||!u.enabled||u.deletedAt||!judgeAccountEnabled(u)||!valid)throw Error('아이디 또는 비밀번호를 확인하세요.');
 await db.workRecord.deleteMany({where:authKey('loginLimit',id)});
 return {user:publicUser(u),token:await createSession(u.id,u.credentialVersion??0)};
}
export async function createAccount(input:unknown,creator:Principal|null,bootstrapToken?:string,temporary=creator!==null){
 const b=accountSchema.parse(input),hash=await passwordHash(b.password);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:accounts'))`;
  const rows=await tx.workRecord.findMany({where:{workspace:'auth',kind:'user'}}),users=rows.map(r=>r.payload as User);
  if(!creator){
   const setup=await tx.workRecord.findUnique({where:{workspace_kind_id:authKey('bootstrap','initial')}});const p=setup?.payload as any;
   if(users.length||!p||p.expiresAt<Date.now()||!bootstrapToken||digest(bootstrapToken)!==p.hash||b.role!=='SUPER_ADMIN'||b.centerId!==null)throw Error('초기 설정 코드가 유효하지 않습니다.');
  }else{const actor=await lockAccountActor(tx,creator);if(actor.role!=='SUPER_ADMIN'&&!(actor.role==='CENTER_ADMIN'&&b.role==='CENTER_STAFF'&&b.centerId===actor.centerId))throw Error('계정 생성 권한이 없습니다.');}
  if(users.some(u=>u.username===b.username))throw Error('이미 사용 중인 아이디입니다.');
  const pending=await tx.workRecord.findMany({where:{workspace:'auth',kind:'application'}});
  if(pending.some(r=>(r.payload as {username:string;status:string}).username===b.username&&(r.payload as {status:string}).status==='PENDING'))throw Error('승인 대기 중인 아이디입니다. 가입 신청에서 처리하세요.');
  if(b.role==='SUPER_ADMIN'&&b.centerId!==null||b.role!=='SUPER_ADMIN'&&!b.centerId)throw Error('소속 센터를 확인하세요.');
  if(b.centerId!==null&&!knownCenter(b.centerId))throw Error('등록된 담당 센터를 선택하세요.');
  const user:User={id:randomUUID(),username:b.username,name:b.name,role:b.role,centerId:b.centerId,enabled:true,passwordHash:hash,mustChangePassword:temporary,credentialVersion:0,...(b.birth?{birth:b.birth}:{}),...(b.phone?{phone:b.phone}:{})};
  await tx.workRecord.create({data:{...authKey('user',user.id),payload:user}});
  if(!creator)await tx.workRecord.delete({where:{workspace_kind_id:authKey('bootstrap','initial')}});
  await tx.audit.create({data:{centerId:b.centerId??'global',action:'account.create',detail:{userId:user.id,actorId:creator?.id??'LOCAL_BOOTSTRAP'}}});
  return publicUser(user);
 });
}
export async function changePassword(principal:Principal,input:unknown){
 if(principal.judgeAccount)throw Error('Public trial account credentials are managed by the deployment administrator.');
 const b=z.object({currentPassword:z.string().min(1).max(128),newPassword:newPasswordSchema}).strict().parse(input);
 if(b.currentPassword===b.newPassword)throw Error('기존 비밀번호와 다른 비밀번호를 입력하세요.');
 const key=authKey('user',principal.id),row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),user=row.payload as User;
 // Reuse the persisted credential check/throttle without leaving a temporary login session.
 const checked=await login(user.username,b.currentPassword);await db.workRecord.deleteMany({where:authKey('session',digest(checked.token))});
 if(checked.user.id!==principal.id)throw Error('계정 확인 실패');
 const nextHash=await passwordHash(b.newPassword);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace='auth' AND kind='user' AND id=${principal.id} FOR UPDATE`;
  const current=(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}})).payload as User;
  if(current.judgeAccount||!current.enabled||current.passwordHash!==user.passwordHash||(current.credentialVersion??0)!==(principal.credentialVersion??0))throw Error('계정이 변경되었습니다. 다시 로그인하세요.');
  const updated:User={...current,passwordHash:nextHash,mustChangePassword:false,credentialVersion:(current.credentialVersion??0)+1};
  await tx.workRecord.update({where:{workspace_kind_id:key},data:{payload:updated,version:{increment:1}}});
  await tx.workRecord.deleteMany({where:{workspace:'auth',kind:'session',payload:{path:['userId'],equals:principal.id}}});
  await tx.audit.create({data:{centerId:current.centerId??'global',action:'account.passwordChange',detail:{actorId:principal.id}}});
  return publicUser(updated);
 });
}
