import {test as base,expect} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,digest,type Role} from '../lib/auth';
export {expect};
export const test=base.extend<{authRole:Role}>({
 authRole:['CENTER_ADMIN',{option:true}],
 extraHTTPHeaders:async({},use)=>{await use({origin:'http://127.0.0.1:3100'})},
 storageState:async({authRole},use)=>{
  if(!['postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_test','postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e'].includes(process.env.DATABASE_URL??''))throw Error('Explicit isolated E2E database required before creating authentication fixtures');
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:'e2e-'+id,name:'테스트 담당자',role:authRole,centerId:authRole==='SUPER_ADMIN'?null:'demo',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
  await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});
  try{await use({cookies:[{name:'kfarm_session',value:token,domain:'127.0.0.1',path:'/',expires:Math.floor(Date.now()/1000)+3600,httpOnly:true,secure:false,sameSite:'Strict'}],origins:[]})}
  finally{await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id},{kind:'session',id:digest(token)}]}});await db.audit.deleteMany({where:{action:'auth.request',detail:{path:['actorId'],equals:id}}})}
 }
});
