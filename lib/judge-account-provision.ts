import {db} from './db';
import {authKey,passwordHash,passwordMatches,publicUser,type User} from './auth';
import {judgeAccessConfig} from './judge-access-config';

// Invoked explicitly by the deployment operator, never from an HTTP endpoint.
export async function provisionJudgeAccount(){
 const config=judgeAccessConfig();if(!config)throw Error('Judge access is not enabled.');
 const key=authKey('user','public-'+config.username);
 const hash=await passwordHash(config.password);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:accounts'))`;
  if(!await tx.center.findUnique({where:{id:config.centerId}}))throw Error('Restore the judge center before provisioning access.');
  const rows=await tx.workRecord.findMany({where:{workspace:'auth',kind:'user'}});
  const matches=rows.filter(r=>r.id===key.id||(r.payload as User).username===config.username);
  if(matches.length){
   const existing=matches[0].payload as User;
   if(matches.length!==1||matches[0].id!==key.id||existing.judgeAccount!==true||existing.role!=='CENTER_ADMIN'||existing.centerId!==config.centerId||existing.username!==config.username||!existing.enabled||existing.deletedAt||existing.mustChangePassword||!await passwordMatches(config.password,existing.passwordHash))throw Error('Existing account differs. No account or credential was overwritten.');
   return {created:false,user:publicUser(existing)};
  }
  if(await tx.workRecord.findFirst({where:{workspace:'auth',kind:'application',payload:{path:['username'],equals:config.username}}}))throw Error('An account application already uses this username.');
  const user:User={id:key.id,username:config.username,name:'K-Farm Judge',role:'CENTER_ADMIN',centerId:config.centerId,enabled:true,passwordHash:hash,mustChangePassword:false,credentialVersion:0,judgeAccount:true};
  await tx.workRecord.create({data:{...key,payload:user}});
  await tx.audit.create({data:{centerId:config.centerId,action:'account.judgeProvisioned',detail:{userId:user.id,actorId:'DEPLOYMENT_OPERATOR'}}});
  return {created:true,user:publicUser(user)};
 });
}
