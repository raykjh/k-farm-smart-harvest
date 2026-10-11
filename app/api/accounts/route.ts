import {centerRegistry,knownCenter} from '@/lib/center-registry';
import {newPasswordSchema} from '@/lib/password-policy';
import {NextResponse} from 'next/server';
import {authenticate,createAccount,publicUser,authKey,passwordHash,type User} from '@/lib/auth';
import {validOrigin} from '@/lib/auth-route';
import {approveApplication,publicApplication,type AccountApplication} from '@/lib/account-applications';
import {db} from '@/lib/db';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const user=await authenticate(req);if(!user)return NextResponse.json({error:'로그인 필요'},{status:401});if(user.mustChangePassword)return NextResponse.json({error:'임시 비밀번호를 먼저 변경해주세요.'},{status:403});
 if(user.role==='CENTER_STAFF'||user.role!=='SUPER_ADMIN'&&!knownCenter(user.centerId))return NextResponse.json({error:'권한 없음'},{status:403});
 const rows=await db.workRecord.findMany({where:{workspace:'auth',kind:'user'}});
 const users=rows.map(r=>r.payload as User).filter(u=>user.role==='SUPER_ADMIN'||u.centerId===user.centerId).map(publicUser);
 const saved=await db.center.findMany();
 const centers=centerRegistry.filter(c=>user.role==='SUPER_ADMIN'||user.centerId===c.id).map(c=>{const row=saved.find(s=>s.id===c.id),state=row?.state as any;return {id:c.id,name:c.name,office:c.office,status:row?'ACTIVE':'NOT_INITIALIZED',fieldCount:state?.fields?.length??0,taskCount:state?.missions?.length??0};});
 const applications=user.role==='SUPER_ADMIN'?(await db.workRecord.findMany({where:{workspace:'auth',kind:'application'}})).map(r=>r.payload as AccountApplication).filter(a=>a.status==='PENDING').map(publicApplication):[];
 return NextResponse.json({users,applications,centers},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'계정 조회 실패'},{status:503})}}
export async function POST(req:Request){
 if(!validOrigin(req))return NextResponse.json({error:'출처 거부'},{status:403});
 try{const user=await authenticate(req);if(!user)return NextResponse.json({error:'로그인 필요'},{status:401});if(user.mustChangePassword)return NextResponse.json({error:'임시 비밀번호를 먼저 변경해주세요.'},{status:403});const raw=await req.text();if(raw.length>5000)throw Error('입력 크기 초과');const b=JSON.parse(raw);
 if(b.action==='approveApplication')return NextResponse.json({user:await approveApplication(user,{id:b.id,role:b.role,centerId:b.centerId})});
 if(b.action==='create')return NextResponse.json({user:await createAccount(b.account,user)});
 if(!['disable','resetPassword'].includes(b.action))throw Error('지원하지 않는 요청');const id=z.string().uuid().parse(b.id);
 const resetHash=b.action==='resetPassword'?await passwordHash(newPasswordSchema.parse(b.password)):null;
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auth:accounts'))`;
  const row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',id)}}),target=row.payload as User;
  if(user.id===id||!(user.role==='SUPER_ADMIN'||user.role==='CENTER_ADMIN'&&target.role==='CENTER_STAFF'&&target.centerId===user.centerId))throw Error('계정 중지 권한 없음');
  await tx.workRecord.update({where:{workspace_kind_id:authKey('user',id)},data:{payload:resetHash?{...target,passwordHash:resetHash,mustChangePassword:true,credentialVersion:(target.credentialVersion??0)+1}:{...target,enabled:false},version:{increment:1}}});
  await tx.workRecord.deleteMany({where:{workspace:'auth',kind:'session',payload:{path:['userId'],equals:id}}});
  if(resetHash)await tx.workRecord.deleteMany({where:authKey('recovery',id)});
  await tx.audit.create({data:{centerId:target.centerId??'global',action:resetHash?'account.passwordReset':'account.disable',detail:{actorId:user.id,userId:id}}});
 });return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'계정 변경 실패'},{status:400})}
}
