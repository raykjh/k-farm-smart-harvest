import {NextRequest,NextResponse} from 'next/server';
import {authenticate,asPrincipal} from './auth';
import {permitted} from './auth-policy';
import {db} from './db';
import {validApplicationOrigin,validApplicationRequest} from './application-origin';
export const validOrigin=validApplicationOrigin;
export function withAuth(path:string,handler:(req:NextRequest)=>Promise<Response>){return async(req:NextRequest)=>{
 try{
 const user=await authenticate(req);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});
 if(!validApplicationRequest(req))return NextResponse.json({error:'출처 거부'},{status:403});
 if(user.mustChangePassword)return NextResponse.json({error:'임시 비밀번호를 먼저 변경해주세요.',code:'PASSWORD_CHANGE_REQUIRED'},{status:403});
 let body:any=null;if(req.method!=='GET'&&req.method!=='HEAD'){
  const raw=await req.clone().text();if(raw.length>2000000)return NextResponse.json({error:'입력 크기 초과'},{status:413});
  try{body=JSON.parse(raw)}catch{return NextResponse.json({error:'JSON 형식 오류'},{status:400})}
 }
 if(!permitted(user,path,req.method,body))return NextResponse.json({error:'이 계정의 역할 또는 소속 센터로 접근할 수 없습니다.'},{status:403});
 // Audit identity comes from the session, never from client headers or input fields.
 if(req.method!=='GET')await db.audit.create({data:{centerId:user.centerId??'global',action:'auth.request',detail:{actorId:user.id,role:user.role,path,action:typeof body?.action==='string'?body.action:null}}});
 const response=await asPrincipal(user,()=>handler(req));response.headers.set('Cache-Control','no-store');return response;
 }catch{return NextResponse.json({error:'인증 또는 처리 서비스를 확인하세요.'},{status:503})}
};}
