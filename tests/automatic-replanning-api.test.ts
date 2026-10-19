import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {testSession} from './auth-fixture';
import {replacementDurationFixture} from './replacement-duration-fixture';
import {recordSpace} from '../lib/workspace';
import type {State} from '../lib/types';
import {emptyCenter} from '../lib/center-registry';
import {saveLoan} from '../lib/center-resources';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_TEST'})}));
import {POST,GET} from '../app/api/replanning/route';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
it('rejects explicit manual conversion requests before comparison or approval',async()=>{
 const session=await testSession(),calls=await db.aiCall.count(),before=await db.center.findMany({orderBy:{id:'asc'}});
 try{
  for(const body of [
   {action:'preview',ids:['any'],manualFallback:true},
   {action:'compare',ids:['any'],alternatives:[{id:'manual',label:'old client',scope:'EXPAND',manualFallback:true}]},
  ]){
   const response=await POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers:session.headers,body:JSON.stringify(body)}));
   expect(response.status).toBe(409);expect((await response.json()).error).toContain('인력 대체는 사용하지 않습니다');
  }
  expect(await db.aiCall.count()).toBe(calls);expect(await db.center.findMany({orderBy:{id:'asc'}})).toEqual(before);
 }finally{await session.cleanup()}
});
it.each(['spare','preapproved','request'] as const)('repair past the crop window uses %s and never moves completed work',async mode=>{
 const f=await laborCapacityFixture(),session=await testSession('CENTER_STAFF'),owner=await testSession('CENTER_ADMIN','janggye'),calls=await db.aiCall.count();
 try{
  const {s,m}=replacementDurationFixture();s.fields[0].area=1000;m.workAreaM2=1000;s.operatorRoster=undefined;s.crewCapacity={operators:1,workers:2};s.staffCount=3;s.centerSharing=undefined;
  s.machines=s.machines.slice(0,1);s.machines[0].status='AVAILABLE';
  const lender=emptyCenter('janggye');lender.machines=[{...s.machines[0],id:'JSJGTR01',ownerCenterId:'janggye'}];lender.staffCount=1;lender.crewCapacity={operators:1,workers:0};lender.transportCount=1;
  await db.center.update({where:{id:'janggye'},data:{state:json(lender)}});
  if(mode==='spare')s.machines.push({...s.machines[0],id:'JB23TR02'});
  if(mode==='preapproved'){const offer=replacementDurationFixture().s.centerSharing!.offers![0];await db.workRecord.create({data:{workspace:'shared',kind:'equipmentSharingOffer',id:offer.id,payload:json(offer)}});}
  await db.center.update({where:{id:'demo'},data:{state:json(s)}});
  const before=await db.center.findUniqueOrThrow({where:{id:'demo'}}),lenderBefore=await db.center.findUniqueOrThrow({where:{id:'janggye'}});
  const input={action:'automatic',requestId:randomUUID(),ids:[m.id],reason:'장비 문제',outage:{machineId:m.resourceId!,from:'2032-09-01',returnOn:'2032-09-10'}};
  const call=async(body:unknown)=>{const res=await POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers:session.headers,body:JSON.stringify(body)}));const result=await res.json();expect(res.status,JSON.stringify(result)).toBe(200);return result};
  const result=await call(input);
  if(mode==='request'){
   expect(result.status).toBe('RESOURCE_REQUIRED');expect(result.loanRequests).toHaveLength(1);
   const key={workspace:'shared',kind:'equipmentLoan',id:result.loanRequests[0].id},loan=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}});
   expect(loan.payload).toMatchObject({status:'REQUESTED',machineId:'JSJGTR01',operatorConfirmed:false,transportConfirmed:false,usableFrom:'2032-09-01',usableUntil:'2032-09-01'});
   expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(before);
   expect(await db.workRecord.count({where:{kind:'centerResourceNotice'}})).toBe(2);
   expect(await call(input)).toEqual(result);
   expect((await call({...input,requestId:randomUUID()})).loanRequests[0].id).toBe(loan.id);
   expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(1);
   await expect(db.$transaction(tx=>saveLoan(tx,{...(loan.payload as object),version:loan.version,status:'CONFIRMED',operatorConfirmed:true,transportConfirmed:true},session.principal))).rejects.toThrow('센터 관리자');
   await db.$transaction(tx=>saveLoan(tx,{...(loan.payload as object),version:loan.version,status:'CONFIRMED',operatorConfirmed:true,transportConfirmed:true},owner.principal));
   expect((await call({...input,requestId:randomUUID()})).status).toBe('APPLIED');
  }else expect(result.status).toBe('APPLIED');
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  expect(saved.missions.find(t=>t.id===m.id)).toMatchObject({scheduledDate:'2032-09-01',resourceId:mode==='spare'?'JB23TR02':'JSJGTR01'});
  expect(saved.machines.find(x=>x.id===m.resourceId)?.downtimes).toContainEqual(input.outage);
  expect(saved.missions.find(t=>t.id==='completed')).toEqual(s.missions[0]);expect(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(lenderBefore);
  expect(await db.workRecord.count({where:{kind:'resourceReservation'}})).toBe(1);expect(await db.aiCall.count()).toBe(calls);
 }finally{await owner.cleanup();await session.cleanup();await f.cleanup()}
});
it.each(['local','adjacent','manual','request'] as const)('center staff automatic %s path persists atomically, replays safely and leaves history/lender unchanged',async mode=>{
 const f=await laborCapacityFixture(),session=await testSession('CENTER_STAFF'),aiBefore=await db.aiCall.count(),outboxBefore=await db.outbox.count({where:{id:{startsWith:'replan:'}}});
 try{
  const {s,m}=replacementDurationFixture();s.fields[0].area=1000;m.workAreaM2=1000;s.operatorRoster=undefined;s.crewCapacity={operators:1,workers:2};s.staffCount=3;
  s.machines=s.machines.slice(0,1);s.centerSharing=undefined;
  if(mode==='local')s.machines.push({...s.machines[0],id:'JB23TR02',status:'AVAILABLE'});
  if(mode==='adjacent'){
   const lender=emptyCenter('janggye');lender.machines=[{...s.machines[0],id:'JSJGTR01',type:'다른 표시명의 트랙터',ownerCenterId:'janggye',status:'AVAILABLE'}];lender.staffCount=1;lender.crewCapacity={operators:1,workers:0};lender.transportCount=1;
   await db.center.update({where:{id:'janggye'},data:{state:json(lender)}});
   const offer=replacementDurationFixture().s.centerSharing!.offers![0];
   await db.workRecord.create({data:{workspace:'shared',kind:'equipmentSharingOffer',id:offer.id,payload:json(offer)}});
  }
  if(mode==='manual')m.manualAlternative={workers:2,minutesPer1000m2:240,setupMinutes:0,transport:0,simpleWorkConfirmed:true,reviewedBy:'격리 검증',basis:'REVIEWED',sourceRef:'test-fixture'};
  await db.center.update({where:{id:'demo'},data:{state:json(s)}});
  const before=await db.center.findUniqueOrThrow({where:{id:'demo'}}),lender=await db.center.findUniqueOrThrow({where:{id:'janggye'}});
  const body={action:'automatic',requestId:randomUUID(),ids:[m.id],reason:'격리 자동 재배치 검증'};
  const call=async(value:unknown)=>{const res=await POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers:session.headers,body:JSON.stringify(value)}));return {status:res.status,data:await res.json()};};
  const response=await call(body);expect(response.status,JSON.stringify(response.data)).toBe(200);
  expect(response.data.status).toBe(mode==='request'||mode==='manual'?'RESOURCE_REQUIRED':'APPLIED');
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  expect(saved.missions.find(x=>x.id==='completed')).toEqual(s.missions[0]);expect(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(lender);
  if(mode==='request'||mode==='manual'){
   expect(response.data.requirements[0].steps).toContain('PROCUREMENT');expect(response.data.requirements[0].steps).not.toContain('MANUAL');expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(before);
   expect(await db.outbox.count({where:{id:{startsWith:'replan:'}}})).toBe(outboxBefore);
  }else{
   expect(saved.missions.find(x=>x.id===m.id)).toMatchObject({resourceId:mode==='adjacent'?'JSJGTR01':'JB23TR02'});
   expect(await db.workRecord.count({where:{kind:'resourceReservation'}})).toBe(1);
   expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(mode==='adjacent'?1:0);
   expect(await db.outbox.count({where:{id:{startsWith:'replan:'}}})).toBe(outboxBefore+1);
  }
  const stable=await db.center.findUniqueOrThrow({where:{id:'demo'}});
  expect((await call(body)).data).toEqual(response.data);expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(stable);
  expect((await call({...body,reason:'다른 요청 내용'})).status).toBe(409);
  const view=await GET(new NextRequest('http://127.0.0.1:3100/api/replanning',{headers:session.headers})),receipts=await view.json();expect(view.status,JSON.stringify(receipts)).toBe(200);
  expect(receipts.requests[0]).toMatchObject({id:body.requestId,status:response.data.status,result:response.data});
  const decisions=await db.workRecord.count({where:{kind:'planningDecision'}});expect(decisions).toBe(1);expect(await db.aiCall.count()).toBe(aiBefore);
 }finally{await session.cleanup();await f.cleanup()}
},60000);
