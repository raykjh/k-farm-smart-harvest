import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import * as svc from '@/lib/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handleGET(){try{return NextResponse.json(await svc.read());}catch{return NextResponse.json({error:'데이터베이스가 준비되지 않았습니다. 실행 안내를 확인하세요.'},{status:503});}}
const base=z.object({action:z.enum(['register','choose','plan','wind','replan','approve','lock','deliver']),key:z.string().uuid(),fieldId:z.enum(['A','B','C']).optional(),area:z.number().min(100).max(100000).optional(),access:z.boolean().optional(),water:z.boolean().optional(),confirmed:z.boolean().optional(),choices:z.array(z.object({fieldId:z.enum(['A','B','C']),crop:z.enum(['쌀','감자','고추']),mode:z.enum(['공동참여형','완전 위탁형'])})).optional(),revisionId:z.string().uuid().optional(),machineId:z.string().max(10).optional(),failFirst:z.boolean().optional(),selectedIds:z.array(z.string().min(1).max(40)).min(1).max(600).optional()});
async function handlePOST(req:NextRequest){
 // Local demo only: same-origin mutation guard, no real user auth or external channels.
 const origin=req.headers.get('origin');const localOrigins=['http://127.0.0.1:3100','http://localhost:3100'];
 if((origin&&!localOrigins.includes(origin))||!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??''))return NextResponse.json({error:'다른 출처 요청 거부'},{status:403});
 try{const b=base.parse(await req.json());let result;
 switch(b.action){
  case'register':if(b.fieldId===undefined||b.area===undefined||b.access===undefined||b.water===undefined||b.confirmed===undefined)throw new Error('등록 입력 누락');result=await svc.register(b.key,b.fieldId,b.area,b.access,b.water,b.confirmed);break;
  case'choose':if(!b.choices)throw new Error('작물 입력 누락');result=await svc.choose(b.key,b.choices);break;
  case'plan':result=await svc.plan(b.key);break;case'wind':result=await svc.wind(b.key);break;case'replan':result=await svc.replan(b.key,b.selectedIds);break;
  case'approve':if(!b.revisionId)throw new Error('변경계획 누락');result=await svc.approve(b.key,b.revisionId);break;
  case'lock':if(!b.machineId)throw new Error('장비 누락');result=await svc.lock(b.key,b.machineId);break;
  case'deliver':result=await svc.deliver(b.failFirst);break;
 }
 return NextResponse.json({ok:true,result});
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'입력 형식이 올바르지 않습니다.':e instanceof Error?e.message:'처리 실패'},{status:e instanceof svc.Conflict?409:400});}
}

export const GET=withAuth('demo',handleGET);
export const POST=withAuth('demo',handlePOST);
