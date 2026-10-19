import {centerRegistry,knownCenter} from '@/lib/center-registry';
import {NextResponse} from 'next/server';
import {authenticate,createAccount,publicUser,type User} from '@/lib/auth';
import {validOrigin} from '@/lib/auth-route';
import {validApplicationRequest} from '@/lib/application-origin';
import {approveApplication,rejectApplication,publicApplication,type AccountApplication} from '@/lib/account-applications';
import {AccountChangeError,changeAccount} from '@/lib/account-management';
import {db} from '@/lib/db';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 if(!validApplicationRequest(req))return NextResponse.json({error:'출처 거부'},{status:403});
 const user=await authenticate(req);if(!user)return NextResponse.json({error:'로그인 필요'},{status:401});if(user.mustChangePassword)return NextResponse.json({error:'임시 비밀번호를 먼저 변경해주세요.'},{status:403});
 if(user.judgeAccount)return NextResponse.json({error:'Public trial accounts cannot manage accounts.'},{status:403});
 if(user.role==='CENTER_STAFF'||user.role!=='SUPER_ADMIN'&&!knownCenter(user.centerId))return NextResponse.json({error:'권한 없음'},{status:403});
 const rows=await db.workRecord.findMany({where:{workspace:'auth',kind:'user'},orderBy:{id:'asc'}});
 const requests=await db.workRecord.findMany({where:{workspace:'auth',kind:'recoveryRequest',payload:{path:['status'],equals:'PENDING'}}});
 const users=rows.filter(r=>{const u=r.payload as User;return !u.deletedAt&&(user.role==='SUPER_ADMIN'||u.centerId===user.centerId)}).map(r=>({...publicUser(r.payload as User),recordVersion:r.version,recoveryRequestedAt:(requests.find(q=>q.id===r.id)?.payload as {requestedAt?:string}|undefined)?.requestedAt??null}));
 const centers=centerRegistry.filter(c=>user.role==='SUPER_ADMIN'||user.centerId===c.id).map(c=>({id:c.id,name:c.name,office:c.office}));
 const applications=user.role==='SUPER_ADMIN'?(await db.workRecord.findMany({where:{workspace:'auth',kind:'application'},orderBy:{updatedAt:'asc'}})).filter(r=>(r.payload as AccountApplication).status==='PENDING').map(r=>({...publicApplication(r.payload as AccountApplication),recordVersion:r.version})):[];
 return NextResponse.json({users,applications,centers},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'계정 조회 실패'},{status:503})}}
export async function POST(req:Request){
 if(!validOrigin(req))return NextResponse.json({error:'출처 거부'},{status:403});
 try{const user=await authenticate(req);if(!user)return NextResponse.json({error:'로그인 필요'},{status:401});if(user.judgeAccount)return NextResponse.json({error:'Public trial accounts cannot manage accounts.'},{status:403});if(user.mustChangePassword)return NextResponse.json({error:'임시 비밀번호를 먼저 변경해주세요.'},{status:403});const raw=await req.text();if(raw.length>5000)throw Error('입력 크기 초과');const b=JSON.parse(raw);
 if(b.action==='approveApplication')return NextResponse.json({user:await approveApplication(user,{id:b.id,role:b.role,centerId:b.centerId,expectedVersion:b.expectedVersion})});
 if(b.action==='rejectApplication')return NextResponse.json(await rejectApplication(user,{id:b.id,expectedVersion:b.expectedVersion,reason:b.reason}));
 if(b.action==='create')return NextResponse.json({user:await createAccount(b.account,user)});
 return NextResponse.json(await changeAccount(user,b));
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'입력한 계정 정보를 확인하세요.':e instanceof Error?e.message:'계정 변경 실패'},{status:e instanceof AccountChangeError?e.status:400})}
}
