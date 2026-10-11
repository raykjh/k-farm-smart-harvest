import {it,expect} from 'vitest';
import {buildAnnualPlan} from '../lib/annual-plan';
import {preserveCompletedWorkAreas} from '../lib/completed-work-area';
import {catalogContext,catalogField,catalogCycle,catalogState} from './catalog-fixtures';
import type {Mission} from '../lib/types';
const plan=(area:number)=>buildAnnualPlan([catalogField('lettuce',area)],2034,1,catalogContext(),catalogCycle('lettuce'),undefined,catalogState());
const done=(ids:string[])=>ids.map(id=>({id,status:'COMPLETED'})) as Mission[];
function assertGraph(p:ReturnType<typeof plan>){
 const tasks=p.plots[0].tasks,seen=new Set<string>();
 for(const t of tasks){expect(t.predecessorKeys.every(k=>seen.has(k)),t.operationKey).toBe(true);expect(seen.has(t.operationKey)).toBe(false);seen.add(t.operationKey);}
}
it('preserves the exact completed area and creates only the remaining area with a valid dependency graph',()=>{
 const old=plan(2000),soil=old.plots[0].tasks.find(t=>t.operationCode==='soil')!,p=plan(4000),before=JSON.stringify(old);
 expect(preserveCompletedWorkAreas(p,old,done([soil.id]))).toEqual([]);
 const parts=p.plots[0].tasks.filter(t=>t.operationCode==='soil');expect(parts).toHaveLength(2);
 expect(parts[0]).toEqual(soil);expect(parts[1]).toMatchObject({workAreaM2:2000,operationKey:soil.operationKey+':part2',predecessorKeys:[soil.operationKey]});
 expect(p.plots[0].tasks.find(t=>t.operationCode==='plant')!.predecessorKeys).toContain(parts[1].operationKey);assertGraph(p);expect(JSON.stringify(old)).toBe(before);
 const same=plan(4000);expect(preserveCompletedWorkAreas(same,p,done(parts.map(t=>t.id)))).toEqual([]);
 expect(same.plots[0].tasks.filter(t=>t.operationCode==='soil')).toEqual(parts);assertGraph(same);
 const larger=plan(5000);expect(preserveCompletedWorkAreas(larger,p,done(parts.map(t=>t.id)))).toEqual([]);
 expect(larger.plots[0].tasks.filter(t=>t.operationCode==='soil').at(-1)).toMatchObject({workAreaM2:1000,part:3});assertGraph(larger);
});
it('keeps each completed harvest occurrence separate and never reduces completed area silently',()=>{
 const old=plan(2000),harvest=old.plots[0].tasks.filter(t=>t.operationCode==='harvest'),p=plan(4000);
 expect(preserveCompletedWorkAreas(p,old,done(harvest.map(t=>t.id)))).toEqual([]);
 for(const n of [1,2,3]){
  const rows=p.plots[0].tasks.filter(t=>t.operationCode==='harvest'&&t.occurrence===n);
  expect(rows.reduce((sum,t)=>sum+('workAreaM2' in t?Number(t.workAreaM2):0),0)).toBeCloseTo(4000);
  for(const prior of harvest.filter(t=>t.occurrence===n))expect(rows.find(t=>t.id===prior.id)).toEqual(prior);
 }
 assertGraph(p);
 expect(preserveCompletedWorkAreas(plan(1000),old,done(harvest.map(t=>t.id))).some(b=>b.includes('작게'))).toBe(true);
});
it('new legacy plans record task area, and area changes with unmeasured historical completion fail closed',()=>{
 const field={...catalogField('rice',2000),conditions:undefined};
 const old=buildAnnualPlan([field],2034,1,{},catalogCycle('rice')),next=buildAnnualPlan([{...field,area:4000}],2034,1,{},catalogCycle('rice'));
 const t=old.plots[0].tasks.find(t=>t.operationCode==='soil')!;
 expect(t.workAreaM2).toBe(2000);expect(preserveCompletedWorkAreas(next,old,done([t.id]))).toEqual([]);
 expect(next.plots[0].tasks.filter(t=>t.operationCode==='soil').map(t=>t.workAreaM2)).toEqual([2000,2000]);
 const historical=structuredClone(old);delete (historical.plots[0].tasks.find(x=>x.id===t.id) as any).workAreaM2;
 const before=JSON.stringify(historical);expect(preserveCompletedWorkAreas(next,historical,done([t.id]))).toContain('완료 작업의 수행 면적이 연결되지 않은 과거 계획입니다. 실적 면적 확인 후 변경하세요.');
 expect(JSON.stringify(historical)).toBe(before);
});
