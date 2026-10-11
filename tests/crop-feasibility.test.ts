import {it,expect} from 'vitest';
import {compareCropFeasibility} from '../lib/crop-feasibility';
import {buildAnnualPlan} from '../lib/annual-plan';
import {registeredDemo} from './registered-demo-fixture';
import {completedSteps} from './planning-fixtures';
it('resource removal changes candidate capacity without reserving anything',async ()=>{
 const s=registeredDemo().state,f=s.fields[0];
 const plan=buildAnnualPlan([{pnu:f.id,address:f.address,area:f.area,crop:'rice',group:'',mode:'joint',rights:'pending'}],2026,1,{anchors:{rice:{planting:'2026-05-25'}}});
 s.missions=completedSteps(f.id,2026,'rice',['nursery','soil']);
 const before=JSON.stringify(s);
 const a=(await compareCropFeasibility([{id:'rice',plan}],s,'2026-05-01'))[0];
 const b=(await compareCropFeasibility([{id:'rice',plan}],{...s,machines:[]},'2026-05-01'))[0];
 expect(a.assigned).toBeGreaterThan(b.assigned);expect(b.status).toBe('INCOMPLETE');expect(a.reserved).toBe(false);expect(JSON.stringify(s)).toBe(before);
});
