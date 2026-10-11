import {newPasswordSchema} from './password-policy';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {db} from './db';
import {authKey,digest,passwordHash,login,type Principal,type User} from './auth';
export async function issueRecoveryCode(user:Principal,currentPassword?:string){
 if(user.role!=='SUPER_ADMIN')throw Error('총괄 계정 전용 복구 수단입니다.');
 if(currentPassword===undefined)throw Error('현재 비밀번호 확인이 필요합니다.');
 const checked=await login(user.username,currentPassword);await db.workRecord.deleteMany({where:authKey('session',digest(checked.token))});
 const code=randomBytes(32).toString('hex');
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace='auth' AND kind='user' AND id=${user.id} FOR UPDATE`;
  const u=(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',user.id)}})).payload as User;
  if(!u.enabled||u.role!=='SUPER_ADMIN'||(u.credentialVersion??0)!==(user.credentialVersion??0))throw Error('다시 로그인하세요.');
  await tx.workRecord.upsert({where:{workspace_kind_id:authKey('recovery',user.id)},create:{...authKey('recovery',user.id),payload:{hash:digest(code)}},update:{payload:{hash:digest(code)},version:{increment:1}}});
  await tx.audit.create({data:{centerId:'global',action:'account.recoveryCodeIssued',detail:{actorId:user.id}}});
 });return code;
}
export async function recoverAccount(input:unknown){
 const b=z.object({username:z.string().trim().toLowerCase().min(1).max(100),code:z.string().regex(/^[a-f0-9]{64}$/),newPassword:newPasswordSchema}).strict().parse(input);
 const attemptKey=authKey('recoveryLimit',digest(b.username));
 const allowed=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recovery:${b.username}`}))`;
  const row=await tx.workRecord.findUnique({where:{workspace_kind_id:attemptKey}}),old=row?.payload as any;
  const v=old&&old.until>Date.now()?old:{count:0,until:Date.now()+15*60000};if(v.count>=5)return false;v.count++;
  await tx.workRecord.upsert({where:{workspace_kind_id:attemptKey},create:{...attemptKey,payload:v},update:{payload:v}});return true;
 });if(!allowed)throw Error('복구 시도 제한입니다. 15분 후 다시 시도하세요.');
 const users=await db.workRecord.findMany({where:{workspace:'auth',kind:'user'}}),u=users.map(x=>x.payload as User).find(x=>x.username===b.username&&x.role==='SUPER_ADMIN'&&x.enabled);
 const evidence=u?await db.workRecord.findUnique({where:{workspace_kind_id:authKey('recovery',u.id)}}):null;
 if(!u||(evidence?.payload as any)?.hash!==digest(b.code))throw Error('아이디 또는 복구 코드를 확인하세요.');
 const nextHash=await passwordHash(b.newPassword),newCode=randomBytes(32).toString('hex');
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace='auth' AND kind='user' AND id=${u.id} FOR UPDATE`;
  const current=(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',u.id)}})).payload as User;
  const code=(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('recovery',u.id)}})).payload as any;
  if(!current.enabled||current.role!=='SUPER_ADMIN'||code.hash!==digest(b.code))throw Error('이미 사용되었거나 변경된 복구 코드입니다.');
  await tx.workRecord.update({where:{workspace_kind_id:authKey('user',u.id)},data:{payload:{...current,passwordHash:nextHash,mustChangePassword:false,credentialVersion:(current.credentialVersion??0)+1},version:{increment:1}}});
  await tx.workRecord.update({where:{workspace_kind_id:authKey('recovery',u.id)},data:{payload:{hash:digest(newCode)},version:{increment:1}}});
  await tx.workRecord.deleteMany({where:{workspace:'auth',kind:'session',payload:{path:['userId'],equals:u.id}}});
  await tx.workRecord.deleteMany({where:{workspace:'auth',kind:'loginLimit',id:digest(b.username)}});
  await tx.audit.create({data:{centerId:'global',action:'account.recovered',detail:{actorId:u.id}}});
 });return {code:newCode};
}
