import {it,expect} from 'vitest';
import {makeContract} from '../lib/annual-replanning';
import {missionPrerequisites} from '../lib/mission-prerequisites';
import {replanResolutionNeeds} from '../lib/replan-resolution';
import {replacementDurationFixture} from './replacement-duration-fixture';
import type {Mission} from '../lib/types';
type Linked=Mission&{operationCode:string;predecessorMissionIds:string[];occurrence?:number;equipmentSplit?:{groupId:string}};
const weather={status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'TEST'} as any,asOf='2032-09-01';
function fixture(){
 const {s,m}=replacementDurationFixture();s.centerSharing=undefined;s.operatorRoster=undefined;s.machines=[];s.staffCount=3;s.crewCapacity={operators:0,workers:3};
 const task={...m,resourceId:null,owner:'센터 인력' as const,staff:1,ordinaryWorkers:1,machineOperators:0,operatorIds:[],transport:0,duration:4,planningWindow:{...m.planningWindow!,duration:4}};
 const plant:Linked={...task,id:'plant',operationCode:'plant',predecessorMissionIds:[],scheduledDate:'2032-05-01',status:'COMPLETED'};
 const treat:Linked={...task,id:'treat',operationCode:'treat',predecessorMissionIds:['plant'],scheduledDate:'2032-08-30',status:'PLANNED'};
 const harvest:Linked={...task,id:'harvest',operationCode:'harvest',predecessorMissionIds:['treat'],status:'PLANNED'};
 s.missions=[plant,treat,harvest];return {s,plant,treat,harvest};
}
it('continues harvest after missed spraying while preserving the missing work and warning',()=>{
 const {s,treat,harvest}=fixture(),before=structuredClone(s);
 const result=makeContract(s,{ids:[harvest.id],deferAfter:asOf},weather,asOf);
 expect(result.contract.tasks.find(t=>t.id===harvest.id)!.allowed.length).toBeGreaterThan(0);
 expect(result.warnings.some(w=>w.includes('미완료·생략'))).toBe(true);
 expect(s).toEqual(before);expect(treat.status).toBe('PLANNED');
 expect(replanResolutionNeeds(s,{ids:[harvest.id]},weather,asOf)[0].steps).not.toContain('PREREQUISITE');
});
it.each(['PLANNED','CANCELLED'] as const)('still blocks harvest if planting is %s, including behind a care chain',status=>{
 const {s,plant,harvest}=fixture();plant.status=status;
 const result=makeContract(s,{ids:[harvest.id],deferAfter:asOf},weather,asOf);
 expect(result.contract.tasks.find(t=>t.id===harvest.id)!.allowed).toEqual([]);
 expect(replanResolutionNeeds(s,{ids:[harvest.id]},weather,asOf)[0].steps).toContain('PREREQUISITE');
});
it('allows later harvest rounds after a missed round, but not a skipped split package',()=>{
 const {s,treat,harvest}=fixture();treat.operationCode='harvest';treat.occurrence=1;harvest.occurrence=2;
 expect(missionPrerequisites(s,harvest,asOf).required.map(m=>m.id)).toEqual(['plant']);
 treat.equipmentSplit={groupId:'one'};harvest.equipmentSplit={groupId:'one'};
 expect(missionPrerequisites(s,harvest,asOf).required.map(m=>m.id)).toEqual(['treat']);
});
it('preserves upcoming work order, pesticide review and unknown prerequisites',()=>{
 const {s,treat,harvest}=fixture();treat.scheduledDate=asOf;
 expect(missionPrerequisites(s,harvest,asOf).required.map(m=>m.id)).toEqual(['treat']);
 treat.scheduledDate='2032-08-30';treat.operationCode='scout';harvest.operationCode='treat';
 expect(missionPrerequisites(s,harvest,asOf).required.map(m=>m.id)).toEqual(['treat']);
 harvest.operationCode='harvest';treat.operationCode='custom-required-step';
 expect(missionPrerequisites(s,harvest,asOf).required.map(m=>m.id)).toEqual(['treat']);
});
it('does not bypass withdrawal or crop-change cancellations',()=>{
 const {s,treat,harvest}=fixture();treat.status='CANCELLED';treat.cancellation={requestId:'r',category:'WITHDRAWAL',reason:'withdrawn',confirmedAt:'2032-08-31T00:00:00Z',confirmedBy:'staff'};
 expect(missionPrerequisites(s,harvest,asOf).required.map(m=>m.id)).toEqual(['treat']);
});
