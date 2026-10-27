import {it,expect} from 'vitest';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {buildAnnualPlan} from '../lib/annual-plan';
import {registeredDemo} from './registered-demo-fixture';
import {completedSteps} from './planning-fixtures';
import {jointSource} from './integrated-plan-fixture';
import {dateSlot} from '../lib/scheduling-engine';
import type {Mission} from '../lib/types';
it('blocks past appointments and leaves unknown steps pending',async ()=>{
 const s=registeredDemo().state,f=s.fields[0];const p=buildAnnualPlan([{pnu:f.id,address:f.address,area:f.area,crop:'rice',group:'',mode:'joint',rights:'pending'}],2026,1,{anchors:{rice:{planting:'2026-05-25'}}});
 expect((await previewAnnualDispatch(p,s,'2026-09-10')).assignments).toHaveLength(0);
 const result=(await previewAnnualDispatch(p,{...s,missions:completedSteps(f.id,2026,'rice',['nursery','soil'])},'2026-05-01'));expect(result.assignments).toHaveLength(1);expect(result.pending.length).toBe(p.taskCount-1);
});
it('preserves completed equipment occupancy when appending a historical cultivation, while cancellation releases it',async()=>{
 const s=jointSource('demo',1),plan=buildAnnualPlan(s.fields.map(f=>({...f,crop:'potato' as const})),2027,1,s.criteria.profiles[0].context);
 const task=plan.plots[0].tasks.find(t=>t.operationCode==='soil')!;task.window={from:'2027-03-01',to:'2027-03-01',basis:'SYNTHETIC'};task.predecessorKeys=[];plan.plots[0].tasks=[task];
 const state=s.state!;state.machines=state.machines.filter(m=>m.id.endsWith('TR01'));expect(state.machines).toHaveLength(1);
 state.missions=[{id:'preserved-completed',fieldId:'another-field',resourceId:state.machines[0].id,scheduledDate:'2027-03-01',start:dateSlot('2027-03-01'),duration:32,status:'COMPLETED',staff:0,transport:0,resourceOccupancyOnly:true} as Mission];
 const before=JSON.stringify(state),blocked=await previewAnnualDispatch(plan,state,'2027-02-01');expect(blocked.assignments).toHaveLength(0);expect(JSON.stringify(state)).toBe(before);
 const cancelled=structuredClone(state);cancelled.missions[0].status='CANCELLED';expect((await previewAnnualDispatch(plan,cancelled,'2027-02-01')).assignments).toHaveLength(1);
});
