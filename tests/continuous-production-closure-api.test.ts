import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {registrationCommand} from '../lib/registration-service';
import {demoInputBatchSchema} from '../lib/registration-origin';
import {intakeField} from '../lib/registration-intake';
import type {State} from '../lib/types';
import {testSession} from './auth-fixture';
import {catalogContext,catalogField,catalogState} from './catalog-fixtures';
import * as engine from '../lib/scheduling-engine';
import {calculateCurrentSchedule} from './current-solver';
import {POST as register} from '../app/api/registrations/route';
import {POST as production} from '../app/api/continuous-production/route';
import {POST as cancel} from '../app/api/task-cancellations/route';
import {POST as execution} from '../app/api/execution-records/route';

const scope={workspace:{in:['sandbox','shared']}};
async function snapshot(){return {
 center:await db.center.findUnique({where:{id:'demo'}}),
 records:await db.workRecord.findMany({where:scope}),
 notices:await db.outbox.findMany({where:{centerId:'demo'}}),
 audits:await db.audit.findMany({where:{centerId:'demo'}}),
};}
let prior:Awaited<ReturnType<typeof snapshot>>;
let session:Awaited<ReturnType<typeof testSession>>;
let solver:ReturnType<typeof vi.spyOn>;
beforeAll(async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test')||process.env.AI_MODE!=='demo')throw Error('Disposable, model-free test DB required');
 prior=await snapshot();session=await testSession();
 await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:scope});await tx.outbox.deleteMany({where:{centerId:'demo'}});await tx.audit.deleteMany({where:{centerId:'demo'}});
  const state=catalogState();
  await tx.center.upsert({where:{id:'demo'},create:{id:'demo',state:state as any},update:{state:state as any}});
 });
 solver=vi.spyOn(engine,'solveSchedule').mockImplementation(calculateCurrentSchedule);
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2033-12-31T18:00:00+09:00'));
});
afterAll(async()=>{
 vi.useRealTimers();solver?.mockRestore();
 if(prior)await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:scope});await tx.outbox.deleteMany({where:{centerId:'demo'}});await tx.audit.deleteMany({where:{centerId:'demo'}});
  if(prior.center)await tx.center.upsert({where:{id:'demo'},create:prior.center as any,update:prior.center as any});
  else await tx.center.deleteMany({where:{id:'demo'}});
  if(prior.records.length)await tx.workRecord.createMany({data:prior.records as any});
  if(prior.notices.length)await tx.outbox.createMany({data:prior.notices});
  if(prior.audits.length)await tx.audit.createMany({data:prior.audits as any});
 },{timeout:30000});
 await session?.cleanup();
});
const call=async(handler:(r:NextRequest)=>Promise<Response>,body:object,status=200)=>{
 const r=await handler(new NextRequest('http://127.0.0.1:3100/api/continuation-test',{method:'POST',headers:session.headers,body:JSON.stringify(body)}));
 const result=await r.json();expect(r.status,JSON.stringify(result)).toBe(status);return result;
};
const state=async()=>(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
const key=(kind:string,id='current')=>({where:{workspace_kind_id:{workspace:'sandbox',kind,id}}});
const criteria=(year:number)=>({profiles:[{id:'season',name:'격리 검증용 작기',context:catalogContext(year),dataOrigin:'DEMO',sourceBatchId:'isolated-crop30-test'}]});

it('registers, records an optional omission and results, then approves the next cultivation through ordinary APIs with old records intact',async()=>{
 const paid=await db.aiCall.count(),budgets=await db.aiBudget.findMany();
 await call(production,{action:'criteria',version:0,criteria:criteria(2034)});
 const f=catalogField('soybean'),{geometry,selected,...plot}=intakeField(f.pnu,f.address),batchId=randomUUID();
 const command=registrationCommand.parse({requestId:randomUUID(),consultationId:randomUUID(),consultationVersion:0,fieldVersion:0,testDataOnly:true,demoInputBatchId:batchId,cultivations:[],continuousService:{from:'2033-12-31',until:null,continuousConsent:true},consultation:{farmer:{name:'홍검증',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},application:{policy:'OWNER_SERVICE_V1',residence:'격리 검증 주소',cultivationHistory:'가상 경작 이력',supportReason:'테스트 입력',exceptionReason:'',review:'pending'},consent:true,step:3,fields:[{...plot,area:'1000',conditions:f.conditions,mode:'delegated',tenure:'owned'}]}});
 const batch=demoInputBatchSchema.parse({version:'demo-registration-inputs-v1',id:batchId,centerId:'demo',status:'READY',registrations:[{requestId:command.requestId,inputHash:createHash('sha256').update(JSON.stringify(command)).digest('hex')}]});
 await db.workRecord.create({data:{workspace:'sandbox',kind:'demoInputBatch',id:batchId,payload:batch}});
 const registered=await call(register,command);expect(registered.production.items[0].status).toBe('REVIEW');
 const first=(await call(production,{action:'refresh'})).view;
 await call(production,{action:'approve',requestId:randomUUID(),fingerprint:first.fingerprint,pnus:[f.pnu],provisionalAcknowledged:true});
 const tasks=(await state()).missions.sort((a,b)=>a.scheduledDate!.localeCompare(b.scheduledDate!)||a.start-b.start);
 const scout=tasks.find(m=>m.id.endsWith(':scout'))!;expect(scout.kind).toBe('INSPECTION');
 const finish=tasks.find(m=>m.id.endsWith(':finish'))!;
 const record=async(m:State['missions'][number])=>{
  vi.setSystemTime(new Date(m.scheduledDate+'T18:00:00+09:00'));
  const from=480+((m.start%32+32)%32)*15,stamp=(n:number)=>m.scheduledDate+'T'+String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')+':00+09:00';
  const result=await call(execution,{kind:'execution',input:{id:randomUUID(),missionId:m.id,expectedPlanVersion:(await state()).planVersion,expectedEvidenceId:null,status:'COMPLETED',startedAt:stamp(from),finishedAt:stamp(from+m.duration*15),actor:'ignored-client-actor',reason:'가상 신청인의 작업 결과 입력'}});
  expect(result.item).toMatchObject({source:'DEMO_SIMULATION',sourceBatchId:batchId,actualStartedAt:null,actualFinishedAt:null});
 };
 for(const task of tasks){
  if(task.id===finish.id)continue;
  if(task.id===scout.id){
   vi.setSystemTime(new Date(task.scheduledDate+'T18:00:00+09:00'));
   const b={requestId:randomUUID(),expectedPlanVersion:(await state()).planVersion,missionIds:[task.id],category:'UNNECESSARY',reason:'가상 담당자: 별도 예찰로 대체하여 이 작업 생략',unperformedConfirmed:true};
   await call(cancel,b);expect((await call(cancel,b)).alreadyApplied).toBe(true);
  }else await record(task);
 }
 vi.setSystemTime(new Date('2034-12-31T18:00:00+09:00'));
 await call(production,{action:'criteria',version:1,criteria:criteria(2035)});
 expect((await call(production,{action:'refresh'})).view.items[0].status).toBe('BLOCKED');
 await record(finish);vi.setSystemTime(new Date('2034-12-31T18:00:00+09:00'));
 // Emulate previously stored missions, which did not carry operation kind.
 // The saved cultivation plan is the evidence; old mission rows stay unchanged.
 const historic=await state();historic.missions.forEach(m=>delete m.kind);
 await db.center.update({where:{id:'demo'},data:{state:historic as any}});
 const cycle=await db.workRecord.findFirstOrThrow({where:{workspace:'sandbox',kind:'cultivation'}});
 const oldPlan=await db.workRecord.findUniqueOrThrow(key('cultivationPlan',cycle.id));
 const oldResults=await db.workRecord.findMany({where:{workspace:'sandbox',kind:{in:['taskCancellation','taskExecutionAssessment']}},orderBy:[{kind:'asc'},{id:'asc'}]});
 const next=(await call(production,{action:'refresh'})).view;
 expect(next.items[0].status,JSON.stringify(next.items[0])).toBe('REVIEW');
 expect(next.items[0].proposal.cultivation.previousId).toBe(cycle.id);
 expect(next.items[0].proposal.plan.plots[0].tasks.flatMap((t:any)=>t.predecessorKeys)).not.toContain(scout.id);
 expect(await state()).toEqual(historic);
 const approval={action:'approve',requestId:randomUUID(),fingerprint:next.fingerprint,pnus:[f.pnu],provisionalAcknowledged:true};
 const applied=await call(production,approval);expect(applied.notifications).toBe(1);
 expect((await call(production,approval)).alreadyApplied).toBe(true);
 const after=await state();expect(after.missions.slice(0,historic.missions.length)).toEqual(historic.missions);
 expect(after.missions.slice(historic.missions.length).every(m=>m.status==='PLANNED'&&m.kind)).toBe(true);
 expect(after.fields[0]).toMatchObject({source:'DEMO_ASSUMPTION',demoBatchId:batchId});
 expect(await db.workRecord.findUniqueOrThrow(key('cultivationPlan',cycle.id))).toEqual(oldPlan);
 expect(await db.workRecord.findUniqueOrThrow(key('cultivation',cycle.id))).toEqual(cycle);
 expect(await db.workRecord.findMany({where:{workspace:'sandbox',kind:{in:['taskCancellation','taskExecutionAssessment']}},orderBy:[{kind:'asc'},{id:'asc'}]})).toEqual(oldResults);
 expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(2);
 expect((await call(production,{action:'refresh'})).view.items[0].status).toBe('SCHEDULED');
 expect(await db.outbox.count({where:{id:{startsWith:'delegated:'+approval.requestId+':'},status:'RECORDED_ONLY'}})).toBe(1);
 expect(await db.outbox.count({where:{id:{startsWith:'delegated:'+approval.requestId+':'},status:'PENDING'}})).toBe(0);
 expect(await db.aiCall.count()).toBe(paid);expect(await db.aiBudget.findMany()).toEqual(budgets);
},60000);
