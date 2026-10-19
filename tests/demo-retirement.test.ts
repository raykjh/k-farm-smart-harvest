import {expect,it} from 'vitest';
import {planDemoRetirement} from '../lib/demo-retirement';
import {retirementFixture} from './demo-retirement-fixture';

it('selects only verified registration descendants and preserves independent records and equipment',()=>{
 const f=retirementFixture(),before=structuredClone(f.snapshot),p=planDemoRetirement(f.snapshot);
 expect(p.safe).toBe(true);expect(p.counts).toMatchObject({fields:30,tasks:460,records:35,outbox:1,receipts:0});
 expect(p.records.map(r=>JSON.parse(r).id)).not.toContain('keep');expect(p.equipmentRetained).toBe(16);expect(f.snapshot).toEqual(before);
});
it.each(['UNKNOWN','MIXED','ACTUAL','FOREIGN','PENDING'] as const)('blocks %s dependencies instead of cascading through them',kind=>{
 const f=retirementFixture(),pnu=f.b.fields[0].pnu;
 if(kind==='UNKNOWN')f.snapshot.records.push(f.record('futureKind','unknown',{pnu}));
 if(kind==='MIXED')f.snapshot.records.push(f.record('annualPlan','mixed',{plots:[{pnu},{pnu:'9999999999999999999'}]}));
 if(kind==='ACTUAL')f.snapshot.records.push(f.record('taskExecutionAssessment','actual',{missionId:f.mission.id,source:'ACTUAL'}));
 if(kind==='FOREIGN')f.snapshot.records.push(f.record('resourceReservation','foreign',{centerId:'gyenam',taskId:f.mission.id,resourceId:f.mission.resourceId},'shared'));
 if(kind==='PENDING')f.snapshot.outbox.push(JSON.stringify({id:'sending',centerId:'demo',farmerId:f.b.state.fields[0].farmerId,status:'PENDING'}));
 expect(planDemoRetirement(f.snapshot).safe).toBe(false);
});
it('retains old archives, unrelated registrations and old receipts rather than guessing their ownership',()=>{
 const f=retirementFixture();f.snapshot.records.push(f.record('removedDemo','archive',f.b.state),f.record('consultation','manual',{farmer:{name:'수동 입력'}}));
 f.snapshot.receipts.push(JSON.stringify({id:'old',operation:'plan',result:{planVersion:1}}));
 const p=planDemoRetirement(f.snapshot);expect(p.safe).toBe(true);expect(p.receipts).toEqual([]);expect(p.records.map(r=>JSON.parse(r).id)).not.toEqual(expect.arrayContaining(['archive','manual']));
});
it('blocks another center referencing the retired field and binds the token to every observed row',()=>{
 const f=retirementFixture(),p=planDemoRetirement(f.snapshot);f.snapshot.records.push(f.record('manual-note','changed',{text:'new'}));expect(planDemoRetirement(f.snapshot).token).not.toBe(p.token);
 f.snapshot.centers.push(JSON.stringify({id:'gyenam',version:1,state:{fields:[{id:f.b.fields[0].pnu}]}}));expect(planDemoRetirement(f.snapshot).blockers).toContainEqual({code:'FOREIGN_CENTER',kind:'Center',count:1});
});
it('requires intact source registrations and refuses a mixed real aggregate',()=>{
 const f=retirementFixture();const center=JSON.parse(f.snapshot.centers[0]);center.state.fields[0].source='REGISTERED';f.snapshot.centers[0]=JSON.stringify(center);
 expect(()=>planDemoRetirement(f.snapshot)).toThrow('범위');
});
it('keeps newly configured equipment but rejects changed farmer linkage and mislabeled actual evidence',()=>{
 const f=retirementFixture(),center=JSON.parse(f.snapshot.centers[0]);center.state.machines.push({...center.state.machines[0],id:'NEW-REGISTERED-EQUIPMENT'});f.snapshot.centers[0]=JSON.stringify(center);
 expect(planDemoRetirement(f.snapshot)).toMatchObject({safe:true,equipmentRetained:17});
 f.snapshot.records.push(f.record('taskExecutionAssessment','mislabeled',{missionId:f.mission.id,source:'DEMO_SIMULATION',actualFinishedAt:'2026-10-10T09:00:00Z'}));expect(planDemoRetirement(f.snapshot).safe).toBe(false);
 center.state.fields[0].farmerId=center.state.fields[1].farmerId;f.snapshot.centers[0]=JSON.stringify(center);expect(()=>planDemoRetirement(f.snapshot)).toThrow('범위');
});
it.each(['pnus','ids','assignments'])('rejects mixed %s collections instead of deleting a partially linked record',key=>{
 const f=retirementFixture();const value=key==='assignments'?[{id:f.mission.id},{id:'another-work-item'}]:[key==='pnus'?f.b.fields[0].pnu:f.mission.id,'another-work-item'];
 f.snapshot.records.push(f.record('replanning','mixed-list',{[key]:value}));expect(planDemoRetirement(f.snapshot).blockers).toContainEqual({code:'MIXED_DEPENDENCY',kind:'replanning',count:1});
});
