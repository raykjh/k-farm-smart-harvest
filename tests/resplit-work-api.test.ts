import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {seedSplitWorkAreas} from './split-work-area-fixture';
import {POST as areas,GET as getAreas} from '../app/api/equipment-missions/route';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_TEST'})}));
import {POST as replan} from '../app/api/replanning/route';
import type {State} from '../lib/types';
it('commits a remaining-part resplit with reservations, frozen geometry, history and one notice',async()=>{
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),admin=await testSession();
 const call=async(handler:(r:NextRequest)=>Promise<Response>,body?:object,status=200)=>{const r=await handler(new NextRequest('http://127.0.0.1:3100/api/test',{method:body?'POST':'GET',headers:admin.headers,...(body?{body:JSON.stringify(body)}:{})})),d=await r.json();expect(r.status,JSON.stringify(d)).toBe(status);return d};
 try{
  const {version,reviewedBy,...area}=f.area;await call(areas,{action:'area',version:0,area});
  const g=(await call(getAreas)).groups[0];await call(areas,{action:'splitArea',version:0,fingerprint:g.reviewFingerprint,area:f.input});
  const closed=f.parts[0];closed.status='COMPLETED';const frozen=structuredClone(closed);
  const original=f.state.machines[0];f.state.machines.push({...original,id:'JB23TR02',capacityHaHour:.04});original.status='MAINTENANCE';
  await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(f.state))}});
  const proposal=await call(replan,{action:'preview',ids:[f.parts[1].id],scope:'PRESERVE',reason:'남은 회차의 저속 장비 대체',replacement:{failedId:original.id,replacementId:'JB23TR02',availableFrom:'2032-09-02',availableUntil:'2032-09-03',arrivalConfirmed:true,compatibilityConfirmed:true,note:'격리 입력: 대체 장비·운영자 확인'}});
  expect(proposal.status,JSON.stringify(proposal)).toBe('FEASIBLE');expect(proposal.workSplit[0].partIds).toHaveLength(2);
  await call(replan,{action:'approve',proposalId:proposal.proposalId});
  expect((await call(replan,{action:'approve',proposalId:proposal.proposalId})).alreadyApplied).toBe(true);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  expect(saved.missions.find(m=>m.id===closed.id)).toEqual(frozen);
  expect(await db.workRecord.count({where:{kind:'taskPlanChange',id:proposal.proposalId+':'+closed.id}})).toBe(0);
  for(const id of proposal.workSplit[0].partIds){
   const reservation=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:'plan:demo:'+id}}});
   expect(reservation.payload).toMatchObject({resourceId:'JB23TR02'});
  }
  let current=await call(getAreas);expect(current.groups[0].ready).toBe(false);expect(current.tasks.every((t:any)=>!t.ready)).toBe(true);
  const updated=current.groups[0],draft=await call(areas,{action:'splitDraft',groupId:f.groupId,fingerprint:updated.reviewFingerprint,axis:'NS'});
  expect(draft.parts.find((p:any)=>p.missionId===closed.id).geometry).toEqual(f.input.parts[0].geometry);
  await call(areas,{action:'splitArea',version:1,fingerprint:updated.reviewFingerprint,area:{...f.input,parts:draft.parts}});
  current=await call(getAreas);expect(current.groups[0].ready).toBe(true);expect(current.tasks).toHaveLength(2);
  for(const task of current.tasks){expect(task.ready,JSON.stringify(task)).toBe(true);await call(areas,{action:'prepare',missionId:task.id,fingerprint:task.fingerprint,requestId:randomUUID()});}
  expect(await db.workRecord.count({where:{kind:'splitWorkAreaHistory'}})).toBe(1);
  expect(await db.outbox.count({where:{id:{startsWith:'replan:'+proposal.proposalId+':'}}})).toBe(1);
  expect(await db.aiCall.count()).toBe(0);
 }finally{await admin.cleanup();await f.cleanup();await base.cleanup();}
},60000);
