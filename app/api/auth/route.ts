import {NextResponse} from 'next/server';
import {z} from 'zod';
import {AUTH_COOKIE,authenticate,login,createAccount,createSession,authKey,digest,sessionToken,changePassword} from '@/lib/auth';
import {submitApplication} from '@/lib/account-applications';
import {db} from '@/lib/db';
import {validOrigin} from '@/lib/auth-route';
import {issueRecoveryCode,recoverAccount} from '@/lib/account-recovery';
import {secureSessionCookie,validApplicationRequest} from '@/lib/application-origin';
import {personalSettings,savePersonalProfile,requestPasswordRecovery} from '@/lib/personal-settings';
export const dynamic='force-dynamic';
export async function GET(req:Request){if(!validApplicationRequest(req))return NextResponse.json({error:'출처 거부'},{status:403});try{return NextResponse.json({user:await authenticate(req)},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'인증 서비스 확인 필요'},{status:503})}}
export async function POST(req:Request){
 if(!validOrigin(req))return NextResponse.json({error:'출처 거부'},{status:403});
 try{
 const raw=await req.text();if(raw.length>4096)throw Error('입력 크기 초과');const b=JSON.parse(raw);let token:string,persistent=true;
 if(!['login','logout','personalSettings'].includes(b.action)&&(await authenticate(req))?.judgeAccount)return NextResponse.json({error:'Public trial account settings cannot be changed.'},{status:403});
 if(b.action==='logout'){
  const old=sessionToken(req);if(old)await db.workRecord.deleteMany({where:authKey('session',digest(old))});const r=NextResponse.json({ok:true});r.cookies.set(AUTH_COOKIE,'',{httpOnly:true,sameSite:'strict',secure:secureSessionCookie(req),path:'/',maxAge:0});return r;
 }
 let user;
 if(['personalSettings','saveProfile','requestRecovery'].includes(b.action)){
  const current=await authenticate(req);if(!current)return NextResponse.json({error:'로그인 필요'},{status:401});
  if(current.mustChangePassword)return NextResponse.json({error:'임시 비밀번호를 먼저 변경해주세요.'},{status:403});
  const result=b.action==='personalSettings'?await personalSettings(current):b.action==='requestRecovery'?await requestPasswordRecovery(current):await savePersonalProfile(current,b.input);
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }
 if(b.action==='signup')return NextResponse.json(await submitApplication(b.application),{headers:{'Cache-Control':'no-store'}});
 if(b.action==='recover')return NextResponse.json(await recoverAccount({username:b.username,code:b.code,newPassword:b.newPassword}),{headers:{'Cache-Control':'no-store'}});
 if(b.action==='recoveryCode'){
  const current=await authenticate(req);if(!current)return NextResponse.json({error:'로그인 필요'},{status:401});
  return NextResponse.json({code:await issueRecoveryCode(current,z.string().min(1).max(128).parse(b.currentPassword))},{headers:{'Cache-Control':'no-store'}});
 }
 if(b.action==='changePassword'){
  const current=await authenticate(req);if(!current)return NextResponse.json({error:'로그인 필요'},{status:401});
  user=await changePassword(current,{currentPassword:b.currentPassword,newPassword:b.newPassword});
  token=await createSession(user.id,user.credentialVersion);
 }else if(b.action==='setup'){
  user=await createAccount({...b.account,role:'SUPER_ADMIN',centerId:null},null,z.string().min(32).max(128).parse(b.token));token=await createSession(user.id);
 }else if(b.action==='login'){
  const credentials=z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(128),remember:z.boolean().default(false)}).parse(b);persistent=credentials.remember;const result=await login(credentials.username,credentials.password);user=result.user;token=result.token;
 }else throw Error('지원하지 않는 요청');
 const old=sessionToken(req);if(old)await db.workRecord.deleteMany({where:authKey('session',digest(old))});
 const response=NextResponse.json({user});response.headers.set('Cache-Control','no-store');response.cookies.set(AUTH_COOKIE,token,{httpOnly:true,sameSite:'strict',secure:secureSessionCookie(req),path:'/',...(persistent?{maxAge:8*3600}:{})});return response;
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'로그인 실패'},{status:400})}
}
