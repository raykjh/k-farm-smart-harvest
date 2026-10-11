import {it,expect} from 'vitest';
import {buildAnnualPlan} from '../lib/annual-plan';
import {registeredDemo} from './registered-demo-fixture';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {completedSteps} from './planning-fixtures';
const f={pnu:'5274036023106160004',address:'시험',crop:'pepper' as const,group:'',area:1000,mode:'full' as const,rights:'pending' as const};
const context={operations:{pepper:{harvest:{laborMinutesPer1000m2:30,setupMinutes:0,occurrences:[{occurrence:1,from:'2027-08-01',to:'2027-08-02'},{occurrence:2,from:'2027-08-10',to:'2027-08-11'}]},finish:{laborMinutesPer1000m2:30,setupMinutes:0,occurrences:[{occurrence:1,from:'2027-08-01',to:'2027-08-03'},{occurrence:2,from:'2027-08-10',to:'2027-08-12'}]}}}};
it('creates stable harvest and corresponding finish rounds with explicit predecessors',async ()=>{
 const p=buildAnnualPlan([f],2027,1,context),tasks=p.plots[0].tasks;
 expect(tasks.filter(t=>t.operationCode==='harvest')).toHaveLength(2);
 expect(tasks.find(t=>t.operationCode==='harvest'&&t.occurrence===2)!.predecessorKeys).toContain('2027:'+f.pnu+':pepper:harvest');
 expect(tasks.find(t=>t.operationCode==='finish'&&t.occurrence===2)!.predecessorKeys).toContain('2027:'+f.pnu+':pepper:harvest:2');
 const s=registeredDemo().state;s.fields=[];s.missions=completedSteps(f.pnu,2027,'pepper',['plant']);
 const result=(await previewAnnualDispatch(p,s,'2027-07-01'));expect(result.assignments).toHaveLength(4);
 const h=result.assignments.find(a=>a.operationKey.endsWith(':harvest:2'))!,finish=result.assignments.find(a=>a.operationKey.endsWith(':finish:2'))!;
 expect(Date.parse(finish.date)+(finish.startMinute*60000)).toBeGreaterThanOrEqual(Date.parse(h.date)+(h.startMinute+h.durationMinutes)*60000);
});
it('blocks missing predecessors and invalid repeat rounds instead of guessing dates',async ()=>{
 const s=registeredDemo().state;s.fields=[];s.missions=[];
 expect((await previewAnnualDispatch(buildAnnualPlan([f],2027,1,context),s,'2027-07-01')).assignments).toHaveLength(0);
 const bad=structuredClone(context);bad.operations.pepper.harvest.occurrences[1].occurrence=1;
 expect(()=>buildAnnualPlan([f],2027,1,bad)).toThrow('회차');
});
