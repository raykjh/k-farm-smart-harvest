import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {lockCenterPool,markSharedFailure} from '@/lib/center-resources';
import {actorLabel} from '@/lib/auth';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {affectedByIncident} from '@/lib/incident';
import {planningState,readExecutionHistory} from '@/lib/replan-history';
import {POST as replan} from '../replanning/route';
import {POST as labor} from '../labor-operations/route';
import type {State} from '@/lib/types';
import type {LaborOps} from '@/lib/labor-operations';
import type {Prisma} from '@prisma/client';
const local=(r:NextRequest)=>['localhost:3100','127.0.0.1:3100'].includes(r.headers.get('host')??'')&&(!r.headers.get('origin')||['http://localhost:3100','http://127.0.0.1:3100'].includes(r.headers.get('origin')!));
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const schema=z.object({id:z.string().uuid(),kind:z.enum(['WIND','RAIN','DROUGHT','BREAKDOWN','ABSENCE']),day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),machineId:z.string().max(150).optional(),jobId:z.string().uuid().optional(),workerId:z.string().uuid().optional()}).strict();
const key=(id:string)=>({workspace_kind_id:{workspace:recordSpace(),kind:'incident',id}});
const request=(path:string,body:unknown,cookie:string)=>new NextRequest('http://127.0.0.1:3100'+path,{method:'POST',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100','Content-Type':'application/json',cookie},body:JSON.stringify(body)});
async function handleGET(req:NextRequest){if(!local(req))return NextResponse.json({error:'출처 거부'},{status:403});try{
 const rows=await db.workRecord.findMany({where:{workspace:recordSpace(),kind:'incident'},orderBy:{updatedAt:'desc'},take:20});
 const roster=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'laborOperations',id:'current'}}}),s=roster?.payload as unknown as LaborOps|undefined;
 return NextResponse.json({events:rows.map(r=>({id:r.id,...r.payload as object})),jobs:s?.jobs.filter(j=>j.status==='OPEN').map(j=>({id:j.id,date:j.date,task:j.task,workers:j.assigned.map(id=>({id,name:s.people.find(p=>p.id===id)?.name??id}))}))??[]},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'사건 조회 실패'},{status:503})}}
async function handlePOST(req:NextRequest){
 if(!local(req))return NextResponse.json({error:'출처 거부'},{status:403});
 let eventId:string|undefined,created=false;
 try{const b=schema.parse(await req.json());eventId=b.id;
 const seeded=await db.$transaction(async tx=>{
  if(b.kind==='BREAKDOWN')await lockCenterPool(tx);
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  const old=await tx.workRecord.findUnique({where:key(b.id)});if(old){if(JSON.stringify((old.payload as any).input)!==JSON.stringify(b))throw Error('같은 사건 ID에 다른 입력입니다.');return {previous:old.payload as any};}
  const row=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}}),s=row.state as unknown as State,history=await readExecutionHistory(tx),effective=planningState(s,history);
  if(b.kind==='BREAKDOWN'){
   const m=s.machines.find(m=>m.id===b.machineId);if(!m||m.safetyLock)throw Error('장비 및 안전잠금 상태 확인 필요');
   if(!affectedByIncident(effective,b.kind,b.day,b.machineId).ids.length)throw Error('대상일에 해당 장비의 미완료 작업이 없습니다.');
   if(m.status==='MAINTENANCE')throw Error('이미 정비 필요 상태입니다. 기존 고장 대응에서 재계획하세요.');
   await markSharedFailure(tx,m.id,b.day,activeCenterId(),actorLabel());
  }
  const selected=affectedByIncident(effective,b.kind,b.day,b.machineId);
  const payload={input:b,status:'PROCESSING',source:'INJECTED_EVENT',createdAt:new Date().toISOString(),selected};
  await tx.workRecord.create({data:{workspace:recordSpace(),kind:'incident',id:b.id,payload:json(payload)}});await tx.audit.create({data:{centerId:activeCenterId(),action:'incident.inject',detail:json(b)}});
  return {selected};
 });
 if(seeded.previous)return NextResponse.json({...seeded.previous.result,eventId:b.id,eventStatus:seeded.previous.status,alreadyRecorded:true});
 created=true;
 let result:any;
 if(b.kind==='ABSENCE'){
  const roster=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'laborOperations',id:'current'}}}),s=roster?.payload as unknown as LaborOps|undefined,j=s?.jobs.find(j=>j.id===b.jobId);
  if(!j||j.date!==b.day||!b.workerId||!j.assigned.includes(b.workerId))throw Error('대상일 작업의 현재 배정자를 선택하세요.');
  const r=await labor(request('/api/labor-operations',{action:'response',jobId:j.id,workerId:b.workerId,response:'DECLINED',version:roster!.version,operator:'LOCAL_SCENARIO_OPERATOR',requestId:b.id},req.headers.get('cookie')??''));const d=await r.json();if(!r.ok)throw Error(d.error);
  const updated=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace(),kind:'laborOperations',id:'current'}}})).payload as unknown as LaborOps,after=updated.jobs.find(v=>v.id===j.id)!;
  result={status:'LABOR_APPLIED',source:'RULES_AND_ALLOCATION',assigned:after.assigned,shortage:Math.max(0,after.count-after.assigned.length),summary:'기존 참석 확인·점수·거리·중복 배정 규칙으로 재배정했습니다. 수동 지정 명단은 존중하며 미확인 인원을 채우지 않습니다.'};
 }else if(b.kind==='DROUGHT')result={status:'REVIEW_REQUIRED',source:'RULES',summary:'용수 공급·토양 수분·관수 가능 여부를 먼저 확인하세요. 자료 없이 관수량이나 새 작업을 생성하지 않았으며 기존 일정을 일괄 취소하지 않았습니다.'};
 else if(!seeded.selected?.ids.length)result={status:'NO_IMPACT',source:'RULES',summary:'대상일에 확인된 영향 작업이 없습니다.'};
 else{
  const body={action:'preview',ids:seeded.selected.ids,day:b.day,...(b.kind==='WIND'||b.kind==='RAIN'?{simulation:{kind:b.kind,from:b.day,to:b.day}}:{})};
  const r=await replan(request('/api/replanning',body,req.headers.get('cookie')??''));result=await r.json();if(!r.ok)result={status:'REVIEW_REQUIRED',source:'COMMON_REPLANNING',summary:result.error};
  if(b.kind==='BREAKDOWN')result={...result,summary:'고장 장비를 정비 필요로 기록했습니다. 대체 장비 호환성·도착일은 임의 확인하지 않습니다. 아래 작업 관리에서 검증된 대체 장비로 다시 계산하세요.'};
 }
 const stored=await db.workRecord.findUniqueOrThrow({where:key(b.id)});await db.workRecord.update({where:key(b.id),data:{payload:json({...stored.payload as object,status:'PROCESSED',result})}});
 return NextResponse.json({...result,eventId:b.id,ids:seeded.selected?.ids??[],unchanged:seeded.selected?.unchanged??[]});
 }catch(e){const message=e instanceof Error?e.message:'사건 처리 실패';if(eventId&&created){const old=await db.workRecord.findUnique({where:key(eventId)});if(old&&(old.payload as any).status==='PROCESSING')await db.workRecord.update({where:key(eventId),data:{payload:json({...old.payload as object,status:'FAILED',result:{summary:message}})}});}return NextResponse.json({error:message},{status:409})}
}

export const GET=withAuth('incidents',handleGET);
export const POST=withAuth('incidents',handlePOST);
