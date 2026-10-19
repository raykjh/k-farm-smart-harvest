import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {replacementDurationFixture} from './replacement-duration-fixture';
import {GET,POST} from '../app/api/replanning/manual-alternative/route';
import type {State} from '../lib/types';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const standard={workers:2,minutesPer1000m2:240,setupMinutes:0,transport:0,sourceRef:'Isolated manual harvest method',simpleWorkConfirmed:true};
async function fixture(){
 const original=await laborCapacityFixture(),session=await testSession('CENTER_STAFF'),{s,m}=replacementDurationFixture();
 m.id=randomUUID();m.label='감자 수확';m.crop='감자';s.fields[0].crop='감자';s.fields[0].area=1000;m.workAreaM2=1000;
 await db.center.update({where:{id:'demo'},data:{state:json(s)}});
 const view=async(id=m.id,headers=session.headers)=>{const r=await GET(new NextRequest('http://127.0.0.1:3100/api/replanning/manual-alternative?missionId='+id,{headers}));return {status:r.status,data:await r.json()}};
 const save=async(b:unknown,headers=session.headers)=>{const r=await POST(new NextRequest('http://127.0.0.1:3100/api/replanning/manual-alternative',{method:'POST',headers,body:JSON.stringify(b)}));return {status:r.status,data:await r.json()}};
 const read=()=>db.center.findUniqueOrThrow({where:{id:'demo'}});
 const request=(version:number)=>({action:'saveManualAlternative',missionId:m.id,version,standard});
 return {s,m,session,view,save,read,request,cleanup:async()=>{await session.cleanup();await original.cleanup()}};
}
it.each(['REGISTERED','DEMO_ASSUMPTION'] as const)('saves reviewed manual inputs for %s without changing schedule, staff, reservations or paid usage',async source=>{
 const f=await fixture();try{
  f.s.fields[0].source=source;await db.center.update({where:{id:'demo'},data:{state:json(f.s)}});
  const before=await f.read(),others=await db.center.findMany({where:{id:{not:'demo'}}}),outbox=await db.outbox.count(),calls=await db.aiCall.count(),records=await db.workRecord.count();
  const view=await f.view();expect(view).toMatchObject({status:200,data:{areaM2:1000,issue:null,standard:null,version:before.version}});
  const saved=await f.save(f.request(view.data.version));expect(saved).toMatchObject({status:200,data:{scheduleChanged:false,people:2,minutes:240,requiresDailySplit:false}});
  const after=await f.read(),state=after.state as unknown as State;
  const target=state.missions.find(m=>m.id===f.m.id)!;
  expect(target.manualAlternative).toMatchObject({...standard,basis:source==='REGISTERED'?'REVIEWED':'DEMO_INPUT',reviewedBy:expect.stringContaining(f.session.id)});
  const expected=structuredClone(f.s);expected.missions.find(m=>m.id===f.m.id)!.manualAlternative=target.manualAlternative;expected.planVersion++;
  expect(state).toEqual(expected);expect(after.version).toBe(before.version+1);
  expect(await db.center.findMany({where:{id:{not:'demo'}}})).toEqual(others);expect(await db.outbox.count()).toBe(outbox);expect(await db.aiCall.count()).toBe(calls);expect(await db.workRecord.count()).toBe(records);
  const audit=await db.audit.findFirstOrThrow({where:{action:'manualAlternative.review',detail:{path:['missionId'],equals:f.m.id}}});expect(audit.detail).toMatchObject({before:null,areaM2:1000,after:target.manualAlternative});
  expect((await f.save(f.request(view.data.version))).status).toBe(409);expect(await f.read()).toEqual(after);
  expect((await f.view()).data.standard).toEqual(target.manualAlternative);
 }finally{await f.cleanup()}
});
it.each(['completed','cancelled','started','locked','specialist-code','specialist-kind','participation','area','unknown-result','recorded-completion'])('refuses unsafe or immutable manual conversion: %s',async mode=>{
 const f=await fixture(),historyId=randomUUID();try{
  if(mode==='completed')f.m.status='COMPLETED';
  if(mode==='cancelled')f.m.status='CANCELLED';
  if(mode==='started')Object.assign(f.m,{executionStartedAt:new Date().toISOString()});
  if(mode==='locked')Object.assign(f.m,{planningLocked:true});
  if(mode==='specialist-code')Object.assign(f.m,{operationCode:'spray'});
  if(mode==='specialist-kind')Object.assign(f.s.machines[0],{ledger:{kind:'SP'}});
  if(mode==='participation')f.s.fields[0].mode='공동참여형';
  if(mode==='area')f.m.workAreaM2=2000;
  if(mode==='unknown-result'||mode==='recorded-completion')await db.workRecord.create({data:{workspace:'sandbox',kind:'taskExecutionAssessment',id:historyId,payload:{missionId:f.m.id,source:'ACTUAL',plannedDate:f.m.scheduledDate,assessment:mode==='recorded-completion'?'COMPLETED':'UNKNOWN'}}});
  await db.center.update({where:{id:'demo'},data:{state:json(f.s)}});const before=await f.read();
  expect((await f.view()).data.issue).not.toBeNull();expect((await f.save(f.request(before.version))).status).toBe(409);expect(await f.read()).toEqual(before);
 }finally{await db.workRecord.deleteMany({where:{workspace:'sandbox',kind:'taskExecutionAssessment',id:historyId}});await f.cleanup()}
});
it('requires a home-center operator, same origin and strict server-owned provenance',async()=>{
 const f=await fixture(),global=await testSession('SUPER_ADMIN',null),other=await testSession('CENTER_STAFF','janggye');try{
  const before=await f.read(),request=f.request(before.version);
  expect((await f.view(f.m.id,other.headers)).status).toBe(404);
  expect((await f.save(request,other.headers)).status).toBe(409);
  expect((await f.save(request,global.headers)).status).toBe(403);
  expect((await f.save(request,{...f.session.headers,origin:'https://untrusted.example'})).status).toBe(403);
  for(const change of [{reviewedBy:'forged'},{basis:'REVIEWED'},{simpleWorkConfirmed:false},{workers:0},{sourceRef:''}])expect((await f.save({...request,standard:{...standard,...change}})).status).toBe(409);
  expect(await f.read()).toEqual(before);
 }finally{await global.cleanup();await other.cleanup();await f.cleanup()}
});
it('records a multi-day estimate honestly without shrinking time to force a placement',async()=>{
 const f=await fixture();try{
  const before=await f.read();const saved=await f.save({...f.request(before.version),standard:{...standard,minutesPer1000m2:1000}});
  expect(saved).toMatchObject({status:200,data:{minutes:1005,requiresDailySplit:true,scheduleChanged:false}});
  expect(((await f.read()).state as unknown as State).missions.find(m=>m.id===f.m.id)?.duration).toBe(f.m.duration);
 }finally{await f.cleanup()}
});
