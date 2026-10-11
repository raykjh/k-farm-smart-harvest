import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {centerRegistry} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
import {fourCenterRegistration,fixtureDay as day} from './four-center-fixture';
import {resetModelFreeOperationsFixture,modelFreeRegistration,spareHarvester} from './model-free-operations-fixture';
import type {Mission,State} from '../lib/types';

// Replace external forecasts only; actual authenticated route handlers, SQL,
// reservation transactions and the HTTP solver are used throughout.
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_ACCEPTANCE'})}));
import {POST as registration} from '../app/api/registrations/route';
import {POST as production} from '../app/api/continuous-production/route';
import {GET as workspace} from '../app/api/workspace/route';
import {GET as resourcesGet,POST as resources} from '../app/api/center-resources/route';
import {GET as laborGet,POST as labor} from '../app/api/labor-operations/route';
import {GET as capacityGet,POST as capacity} from '../app/api/labor-capacity/route';
import {POST as sharing} from '../app/api/labor-sharing/route';
import {POST as replan} from '../app/api/replanning/route';
import {POST as operations} from '../app/api/operations/route';
import {GET as recovery} from '../app/api/labor-recovery/route';

type Handler=(request:NextRequest)=>Promise<Response>;
type Work=Mission&{operationCode?:string};

it('model-free acceptance: intake-generated work, concurrent failures, grounded alternatives, atomic approval and retried local notices',async()=>{
 await resetModelFreeOperationsFixture();
 const tokens:Record<string,string>={};
 for(const c of centerRegistry){
  const id=randomUUID(),token=randomBytes(32).toString('hex');tokens[c.id]=token;
  await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:'acceptance-'+id,name:c.township+' 검증 담당자',role:'CENTER_ADMIN',centerId:c.id,enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
  await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});
 }
 const call=async(c:string,handler:Handler,data?:object,status=200)=>{
  const r=await handler(new NextRequest('http://127.0.0.1:3100/api/verification',{method:data?'POST':'GET',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100',cookie:'kfarm_session='+tokens[c],'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})})),body=await r.json();
  expect(r.status,JSON.stringify(body)).toBe(status);return body;
 };
 const laborAction=async(c:string,data:object,status=200)=>call(c,labor,{...data,version:(await call(c,laborGet)).version,requestId:randomUUID()},status);
 const initial=await db.center.findMany(),calls=await db.aiCall.count(),farmers:Record<string,string>={};
 const initialLoan={id:randomUUID(),version:0,machineId:'JB23TR01',ownerCenterId:'demo',borrowerCenterId:'janggye',usableFrom:day('05-01'),usableUntil:day('05-31'),status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false};
 await call('janggye',resources,initialLoan);await call('demo',resources,{...initialLoan,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true});
 for(const [index,c] of centerRegistry.entries()){
  const input=modelFreeRegistration(index);farmers[c.id]=input.consultationId;
  const receipt=await call(c.id,registration,input);expect((await call(c.id,registration,input)).consultationId).toBe(receipt.consultationId);
  const view=(await call(c.id,production,{action:'refresh'})).view;expect(view.items[0].status,JSON.stringify(view.items)).toBe('REVIEW');
  const approval={action:'approve',requestId:randomUUID(),fingerprint:view.fingerprint,pnus:[view.items[0].pnu],provisionalAcknowledged:true};
  expect((await call(c.id,production,approval)).assigned).toBe(8);expect((await call(c.id,production,approval)).alreadyApplied).toBe(true);
  expect((await call(c.id,workspace)).state.missions).toHaveLength(9);
  expect((await call(c.id,operations,{action:'deliver',key:randomUUID()})).result).toMatchObject({delivered:1,provider:'MOCK_SMS'});
  expect((await call(c.id,operations,{action:'deliver',key:randomUUID()})).result.delivered).toBe(0);
 }
 const normal=(await call('demo',workspace)).state as State,harvest=(normal.missions as Work[]).find(m=>m.operationCode==='harvest')!;
 expect(harvest).toMatchObject({resourceId:'JB23CB01',scheduledDate:day('10-01'),ordinaryWorkers:1,machineOperators:1});
 const others=await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}});
 const ownerState=others.find(c=>c.id==='janggye')!.state as unknown as State;
 const replacement=spareHarvester(ownerState,harvest.scheduledDate!);
 const person=(id:string,name:string)=>({id,name,birth:'1965-01-01',phone:'000-0000-0000',address:'격리 검증용 주소',registeredFarmer:false,usesApp:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['harvest'],active:true});
 const absent=person(randomUUID(),'홍가상'),helper=person(randomUUID(),'홍지원');
 await laborAction('demo',{action:'person',testDataOnly:true,person:absent});await laborAction('janggye',{action:'person',testDataOnly:true,person:helper});
 await laborAction('demo',{action:'open',demandId:harvest.id,pay:'격리된 근무 조건',simpleWorkConfirmed:true});
 const job=(await call('demo',laborGet)).payload.jobs.find((j:any)=>j.missionId===harvest.id&&j.status==='OPEN');
 await laborAction('demo',{action:'response',jobId:job.id,workerId:absent.id,response:'PHONE'});
 await laborAction('demo',{action:'absence',jobId:job.id,workerId:absent.id,reason:'접수로 생성된 수확 작업 불참 검증'});
 expect((await call('demo',recovery)).issues[0].status).toBe('OPEN');
 await call('demo',resources,{action:'failure',machineId:harvest.resourceId,from:day('10-01'),expectedRepairOn:day('10-08')});
 const offer={id:randomUUID(),version:0,machineId:replacement,borrowerCenterId:'demo',from:day('10-01'),to:day('10-01'),compatibleMachineIds:['JB23CB01'],outboundSlots:2,returnSlots:2,agreementRef:'ISOLATED_ACCEPTANCE_ONLY',conditions:'격리된 호환성·운영자·운송 입력',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true};
 await call('janggye',resources,{action:'sharingOffer',offer});
 const compare={action:'compare',ids:[harvest.id],preferred:day('10-01'),reason:'수확기 고장과 참석자 불참 복합 대응',alternatives:[{id:'preserve',label:'빈자리와 확인된 차용',scope:'PRESERVE'},{id:'expand',label:'관련 일정 재배치',scope:'EXPAND'}]};
 const shortage=await call('demo',replan,compare);
 expect(shortage.recommendation).toMatchObject({alternativeId:null,inferenceCalled:false});expect(shortage.results.every((r:any)=>r.status==='NO_FEASIBLE_PLAN')).toBe(true);
 const supportId=randomUUID();
 await call('janggye',capacity,{action:'offer',requestId:supportId,rosterVersion:(await call('janggye',capacityGet)).rosterVersion,window:{workerId:helper.id,borrowerCenterId:'demo',date:day('10-01'),startMinute:480,endMinute:960,travelMinutes:30,workCodes:['harvest'],response:'PHONE',consent:true,reason:'격리된 본인 지원 의사 확인'}});
 const offeredOnly=await call('demo',replan,compare);expect(offeredOnly.recommendation.alternativeId).toBeNull();
 await call('demo',capacity,{action:'confirm',id:supportId,version:1,requestId:randomUUID(),reason:'운송과 작업시간 확인'});
 const confirmed=await call('demo',replan,compare);
 expect(confirmed.recommendation).toMatchObject({source:'RULES',inferenceCalled:false,approval:'REQUIRED',reserved:false});
 expect(confirmed.results.some((r:any)=>r.status==='FEASIBLE'),JSON.stringify(confirmed.results)).toBe(true);
 await call('demo',replan,{...compare,alternatives:[{id:'invented',label:'임의 증원',staff:999}]},409);
 const candidate=confirmed.results.find((r:any)=>r.id===confirmed.recommendation.alternativeId);
 await call('demo',replan,{...candidate.previewRequest,alternativeId:'invented'},409);await call('gyenam',replan,candidate.previewRequest,409);
 const originalProposal=await call('demo',replan,candidate.previewRequest);
 const beforeStale=await db.center.findUniqueOrThrow({where:{id:'demo'}}),loanCount=await db.workRecord.count({where:{kind:'equipmentLoan'}}),outboxCount=await db.outbox.count();
 await call('janggye',resources,{action:'sharingOffer',offer:{...offer,version:1,enabled:false}});
 const bookedMachine=ownerState.missions.find(m=>m.resourceId?.includes('CB')&&m.scheduledDate===harvest.scheduledDate)!.resourceId;
 await call('janggye',resources,{action:'sharingOffer',offer:{...offer,id:randomUUID(),machineId:bookedMachine}});
 const bookedOnly=await call('demo',replan,compare);expect(bookedOnly.recommendation.alternativeId).toBeNull();
 await call('demo',replan,{action:'approve',proposalId:originalProposal.proposalId},409);
 expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(beforeStale);expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(loanCount);expect(await db.outbox.count()).toBe(outboxCount);
 await call('janggye',resources,{action:'sharingOffer',offer:{...offer,version:2}});
 const fresh=await call('demo',replan,compare),selected=fresh.results.find((r:any)=>r.id===fresh.recommendation.alternativeId),proposal=await call('demo',replan,selected.previewRequest);
 await call('demo',replan,{action:'approve',proposalId:proposal.proposalId});expect((await call('demo',replan,{action:'approve',proposalId:proposal.proposalId})).alreadyApplied).toBe(true);
 const final=(await call('demo',workspace)).state as State,changed=final.missions.find(m=>m.id===harvest.id)!;
 expect(changed).toMatchObject({scheduledDate:harvest.scheduledDate,resourceId:replacement,laborSupportIds:[supportId],status:'PLANNED'});
 const changedIds=new Set(proposal.diff.map((d:any)=>d.id));
 for(const m of normal.missions.filter(m=>!changedIds.has(m.id)))expect(final.missions.find(n=>n.id===m.id)).toEqual(m);
 expect(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}})).toEqual(others);
 expect(final.machines.find(m=>m.id===harvest.resourceId)?.status).toBe('MAINTENANCE');
 expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:'plan:demo:'+harvest.id}}})).payload).toMatchObject({resourceId:replacement});
 const roster=(await call('demo',laborGet)).payload,renewed=roster.jobs.find((j:any)=>j.replacesJobId===job.id);
 expect(roster.jobs.find((j:any)=>j.id===job.id).status).toBe('STALE');expect(renewed.responses).toEqual({});expect(renewed.borrowedNames).toEqual([]);
 await laborAction('demo',{action:'response',jobId:job.id,workerId:absent.id,response:'APP'},409);
 await call('janggye',sharing,{action:'offer',requestId:randomUUID(),version:(await call('janggye',laborGet)).version,borrowerCenterId:'demo',jobId:renewed.id,sourceHash:renewed.sourceHash,workerId:helper.id,response:'APP',travelMinutes:30,distanceKm:5,consent:true});
 expect((await call('demo',laborGet)).payload.jobs.find((j:any)=>j.id===renewed.id).borrowedNames).toEqual([helper.name]);
 for(const c of ['demo','janggye']){expect((await call(c,capacityGet)).notices.some((n:any)=>n.event==='PLAN_CHANGED')).toBe(true);expect((await call(c,resourcesGet)).notices.some((n:any)=>n.event==='CONFIRMED')).toBe(true)}
 const notice=await db.outbox.findFirstOrThrow({where:{id:{startsWith:'replan:'+proposal.proposalId+':'},farmerId:farmers.demo}});expect(notice.status).toBe('PENDING');
 expect((await call('demo',operations,{action:'deliver',key:randomUUID(),failFirst:true})).result).toMatchObject({attempted:1,delivered:0,provider:'MOCK_SMS'});
 expect((await call('demo',operations,{action:'deliver',key:randomUUID()})).result.attempted).toBe(0);
 // Advance time only; do not rewrite a queue item to manufacture a successful retry.
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.now()+3000));
 try{
  expect((await call('demo',operations,{action:'deliver',key:randomUUID()})).result.delivered).toBe(1);
  expect((await call('demo',operations,{action:'deliver',key:randomUUID()})).result.delivered).toBe(0);
 }finally{vi.useRealTimers()}
 expect(await db.outbox.count({where:{id:notice.id,status:'DELIVERED',attempts:2}})).toBe(1);
 // Add another owner after recovery: existing missions and re-confirmed attendance stay intact.
 const stable=(await call('demo',workspace)).state as State,oldJobs=(await call('demo',laborGet)).payload.jobs;
 const fieldsRow=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace('demo'),kind:'fields',id:'current'}}});
 const next=fourCenterRegistration(0,randomUUID());next.fieldVersion=fieldsRow.version;next.consultation.farmer.name='홍누적';next.consultation.fields[0].pnu='5274036023110980001';
 await call('demo',registration,next);
 for(const m of stable.missions)expect(((await call('demo',workspace)).state.missions as Mission[]).find(n=>n.id===m.id)).toEqual(m);
 expect((await call('demo',laborGet)).payload.jobs).toEqual(oldJobs);
 for(const c of initial)expect(((await call(c.id,workspace)).state.missions as Mission[]).find(m=>m.id==='past-record')).toEqual((c.state as unknown as State).missions[0]);
 expect(await db.aiCall.count()).toBe(calls);
 const dir='.data/validation/20261004-model-free-operations';mkdirSync(dir,{recursive:true});
 const facts=(c:any)=>({source:c.source,inferenceCalled:c.inferenceCalled,approval:c.approval,reserved:c.reserved,eligibleIds:c.nonDominatedIds,recommendation:c.recommendation,alternatives:c.results.map((r:any)=>({id:r.id,status:r.status,metrics:r.metrics}))});
 writeFileSync(dir+'/api-result.json',JSON.stringify({checkedAt:new Date().toISOString(),database:'kfarm_centers_e2e',normalIntakes:4,generatedTasks:32,normalLocalNotices:4,sameRegisteredCultivation:true,combinedFailureAndAbsence:true,equipmentAloneInsufficient:true,offeredLaborInsufficient:true,bookedLenderEquipmentRejected:true,confirmedResourcesFeasible:true,inventedResourcesRejected:true,foreignCenterRejected:true,staleApprovalRolledBack:true,duplicateApprovalDeduplicated:true,changedTasks:changedIds.size,otherCenterPlansAndCompletedWorkPreserved:true,attendanceReconfirmed:true,bothCenterNotices:true,finalLocalDelivery:true,failedDeliveryRetry:true,duplicateDeliveryPrevented:true,laterIntakePreservesRecovery:true,realDatabase:true,realHttpSolver:true,businessHandlersReplaced:false,browserExecuted:false,paidAiCalls:0,actualSms:false,hardwareCommands:false,decisionBaseline:{equipmentOnly:facts(shortage),offeredLabor:facts(offeredOnly),bookedEquipmentOnly:facts(bookedOnly),confirmedResources:facts(fresh)}},null,2));
},120000);
