import {it,expect} from 'vitest';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {buildAnnualPlan} from '../lib/annual-plan';
import {registeredDemo} from './registered-demo-fixture';
import {completedSteps} from './planning-fixtures';
it('blocks past appointments and leaves unknown steps pending',async ()=>{
 const s=registeredDemo().state,f=s.fields[0];const p=buildAnnualPlan([{pnu:f.id,address:f.address,area:f.area,crop:'rice',group:'',mode:'joint',rights:'pending'}],2026,1,{anchors:{rice:{planting:'2026-05-25'}}});
 expect((await previewAnnualDispatch(p,s,'2026-09-10')).assignments).toHaveLength(0);
 const result=(await previewAnnualDispatch(p,{...s,missions:completedSteps(f.id,2026,'rice',['nursery','soil'])},'2026-05-01'));expect(result.assignments).toHaveLength(1);expect(result.pending.length).toBe(p.taskCount-1);
});
