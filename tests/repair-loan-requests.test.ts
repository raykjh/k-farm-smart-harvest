import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {requestRepairLoans} from '../lib/repair-loan-requests';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {replacementDurationFixture} from './replacement-duration-fixture';
import {testPrincipal} from './auth-fixture';
import {emptyCenter} from '../lib/center-registry';
import type {ResolutionNeed} from '../lib/automatic-replanning';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
it.each(['not-adjacent','incompatible','downtime','booked','prerequisite','completed'] as const)('does not request a repair loan when %s',async condition=>{
 const f=await laborCapacityFixture();try{
  const {s,m}=replacementDurationFixture();s.machines=s.machines.slice(0,1);m.workAreaM2=1000;s.fields[0].area=1000;
  const owner=emptyCenter('janggye');owner.machines=[{...s.machines[0],id:'JSJGTR01',ownerCenterId:'janggye',status:'AVAILABLE'}];
  if(condition==='incompatible')owner.machines[0].compatibleCrops=['potato'];
  if(condition==='downtime')owner.machines[0].downtimes=[{machineId:'JSJGTR01',from:'2032-09-01',returnOn:'2032-09-10'}];
  if(condition==='not-adjacent')await db.workRecord.deleteMany({where:{kind:'centerGeography'}});
  if(condition==='booked')await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:'blocked-repair-fixture',payload:{resourceId:'JSJGTR01',centerId:'janggye',from:'2032-09-01T00:00:00+09:00',to:'2032-09-04T00:00:00+09:00'}}});
  if(condition==='completed')m.status='COMPLETED';
  await db.center.update({where:{id:'janggye'},data:{state:json(owner)}});
  const need:ResolutionNeed={missionId:m.id,task:m.label,from:'2032-09-01',to:'2032-09-03',equipment:'트랙터',people:null,minutes:null,steps:condition==='prerequisite'?['BORROW','PREREQUISITE']:['BORROW'],note:''};
  const result=await db.$transaction(tx=>requestRepairLoans(tx,s,{ids:[m.id],outage:{machineId:m.resourceId!,from:'2032-09-01',returnOn:'2032-09-10'}},[need],{...testPrincipal,role:'CENTER_STAFF'},'2032-09-01'));
  expect(result).toEqual([]);expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);expect(await db.workRecord.count({where:{kind:'centerResourceNotice'}})).toBe(0);
 }finally{await f.cleanup()}
});
