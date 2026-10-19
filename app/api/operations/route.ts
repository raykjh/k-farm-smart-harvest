import {withAuth} from '@/lib/auth-route';
import {inWorkspace,parseWorkspace} from '@/lib/workspace';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import * as svc from '@/lib/service';
import {legacyDemoActions,retiredDemoWorkflow} from '@/lib/legacy-demo-boundary';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function legacyGET(){try{return NextResponse.json(await svc.read());}catch{return NextResponse.json({error:'데이터베이스가 준비되지 않았습니다. 실행 안내를 확인하세요.'},{status:503});}}
const delivery=z.object({action:z.literal('deliver'),key:z.string().uuid(),failFirst:z.boolean().optional()}).strict();
async function actionPOST(req:NextRequest){
 // Authentication, origin and center scope are enforced by withAuth below.
 try{const body=await req.json();
 if(legacyDemoActions.has(body?.action))return NextResponse.json(retiredDemoWorkflow,{status:410});
 const b=delivery.parse(body),result=await svc.deliver(b.failFirst);
 return NextResponse.json({ok:true,result});
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'입력 형식이 올바르지 않습니다.':e instanceof Error?e.message:'처리 실패'},{status:e instanceof svc.Conflict?409:400});}
}
async function handleGET(req:NextRequest){try{return await inWorkspace(parseWorkspace(req.nextUrl.searchParams.get('workspace')),()=>legacyGET())}catch{return NextResponse.json({error:'작업 공간 선택 필요'},{status:400})}}
async function handlePOST(req:NextRequest){try{const selected=parseWorkspace(req.nextUrl.searchParams.get('workspace'));return await inWorkspace(selected,()=>actionPOST(req))}catch{return NextResponse.json({error:'작업 공간 선택 필요'},{status:400})}}

export const GET=withAuth('operations',handleGET);
export const POST=withAuth('operations',handlePOST);
