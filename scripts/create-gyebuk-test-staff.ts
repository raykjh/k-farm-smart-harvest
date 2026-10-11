// Explicit local-owner request only. No public endpoint or automatic startup hook.
import {randomBytes} from 'node:crypto';
import {db} from '../lib/db';
import {createAccount,login,authenticate,authKey,digest,type Principal} from '../lib/auth';
try{
 await db.center.findUniqueOrThrow({where:{id:'demo'}});
 const username='gyebuk.staff',password='Gk!'+randomBytes(12).toString('base64url');
 const actor:Principal={id:'LOCAL_OWNER_REQUEST',username:'local-owner',name:'사용자 요청에 따른 로컬 계정 생성',role:'SUPER_ADMIN',centerId:null,enabled:true};
 const user=await createAccount({username,password,name:'계북면 테스트 담당자',role:'CENTER_STAFF',centerId:'demo'},actor);
 const session=await login(username,password);
 try{
  const verified=await authenticate(new Request('http://127.0.0.1:3100/api/auth',{headers:{cookie:`kfarm_session=${session.token}`}}));
  if(verified?.id!==user.id||verified.role!=='CENTER_STAFF'||verified.centerId!=='demo'||!verified.mustChangePassword)throw Error('Account verification failed');
  console.log(JSON.stringify({created:true,username,temporaryPassword:password,center:'계북면 지역농업관리센터',role:user.role,loginVerified:true,mustChangePassword:true}));
 }finally{await db.workRecord.deleteMany({where:authKey('session',digest(session.token))})}
}catch(e){console.error(e instanceof Error?e.message:'Account creation failed');process.exitCode=1}finally{await db.$disconnect()}
