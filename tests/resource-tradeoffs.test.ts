import {it,expect,vi,afterEach} from 'vitest';
import {resourceTradeoffCase,tradeoffDay} from '../scripts/fixtures/resource-tradeoff-cases';
import {compareReplanAlternatives} from '../lib/planning-decision';
import {recommendPlanningAlternative} from '../lib/planning-adviser';
import {verifyPlanningReview} from '../lib/planning-review';
import {planningResourceMetrics} from '../lib/planning-resource-metrics';

afterEach(()=>vi.unstubAllEnvs());
for(const kind of ['equipment','labor','compound'] as const)it(`real engine: ${kind} has a meaningful external-resource/date tradeoff without modifying the four centers`,async()=>{
 vi.stubEnv('AI_MODE','demo');const c=resourceTradeoffCase(kind),before=JSON.stringify(c.centers);
 const result=await compareReplanAlternatives(c.state,c.request,c.alternatives,c.weather,c.asOf);
 expect(result.results.every(r=>r.status==='FEASIBLE'),JSON.stringify(result.results)).toBe(true);
 const local=result.results[0],external=result.results.at(-1)!;
 expect(local.metrics).toMatchObject({otherChangedTasks:0,preferredDistanceDays:1,borrowedEquipmentMinutes:0,supportPersonMinutes:0});
 expect(external.metrics).toMatchObject({otherChangedTasks:0,preferredDistanceDays:0,borrowedEquipmentMinutes:kind==='labor'?0:240,supportPersonMinutes:kind==='equipment'?0:240});
 expect(result.nonDominatedIds).toContain('local');expect(result.nonDominatedIds).toContain(external.id);
 expect(result.results.every(r=>r.result!.diff.every(d=>d.id==='selected'))).toBe(true);
 const preferred=await recommendPlanningAlternative(result,'','RULES');expect(preferred.alternativeId).toBe(external.id);
 const saved={comparison:result,recommendation:preferred,expires:Date.now()+60000,historyHash:'fixture'};
 expect(()=>verifyPlanningReview(saved,{...local.previewRequest!,newLaborSupport:true},local.id,result.snapshot.id,'fixture')).toThrow('선택');
 const restricted=await compareReplanAlternatives(c.state,{...c.request,decisionPriority:'MIN_EXTERNAL'},c.alternatives,c.weather,c.asOf);
 const economical=await recommendPlanningAlternative(restricted,'','RULES');
 expect(restricted.results.find(r=>r.id===economical.alternativeId)!.metrics).toMatchObject({borrowedEquipmentMinutes:0,supportPersonMinutes:0,preferredDistanceDays:1});
 expect(JSON.stringify(c.centers)).toBe(before);
});
it('an offered but unconfirmed worker, non-adjacent machine and weather cannot be invented into a feasible plan',async()=>{
 const c=resourceTradeoffCase('compound');
 for(const m of c.state.missions)if(m.id==='selected')(m as any).planningWindow.to=tradeoffDay;
 c.state.laborCapacity!.incoming[0].status='OFFERED';
 let result=await compareReplanAlternatives(c.state,c.request,c.alternatives,c.weather,c.asOf);
 expect(result.nonDominatedIds).toEqual([]);
 expect((await recommendPlanningAlternative(result)).inferenceCalled).toBe(false);
 c.state.laborCapacity!.incoming[0].status='CONFIRMED';c.state.centerSharing!.neighborCenterIds=['janggye'];
 result=await compareReplanAlternatives(c.state,c.request,c.alternatives,c.weather,c.asOf);expect(result.nonDominatedIds).toEqual([]);
 c.state.centerSharing!.neighborCenterIds.push('cheoncheon');
 result=await compareReplanAlternatives(c.state,{...c.request,simulation:{kind:'WIND',from:tradeoffDay,to:tradeoffDay}},c.alternatives,c.weather,c.asOf);expect(result.nonDominatedIds).toEqual([]);
});
it('resource totals include unchanged future commitments once and exclude completed or foreign occupancy projections',async()=>{
 const c=resourceTradeoffCase('equipment');
 const unchanged={...c.state.missions[0],id:'unchanged',fieldId:'another',scheduledDate:'2032-12-01',resourceId:'JSCCDR01',duration:8,laborSupportIds:['existing-support']};
 c.state.missions.push(unchanged,{...unchanged,id:'projection',resourceOccupancyOnly:true},{...unchanged,id:'done',status:'COMPLETED'});
 const result=await compareReplanAlternatives(c.state,c.request,c.alternatives,c.weather,c.asOf);
 expect(result.results[0].metrics).toMatchObject({borrowedEquipmentMinutes:120,supportPersonMinutes:120});
 expect(result.results[1].metrics).toMatchObject({borrowedEquipmentMinutes:360,supportPersonMinutes:120});
 const computed=result.results[1].result!;if(computed.status!=='FEASIBLE')throw Error('Expected feasible result');
 const syntheticResult={...computed,diff:[{...computed.diff[0],afterDuration:8}]};
 expect(planningResourceMetrics(c.state,syntheticResult,c.asOf).borrowedEquipmentMinutes).toBe(240);
});
it('no new support preserves existing confirmed assignments and cannot override a base restriction',async()=>{
 const c=resourceTradeoffCase('labor');
 c.state.missions[0].start=2;c.state.missions[0].laborSupportIds=[c.state.laborCapacity!.incoming[0].id];
 const existing=await compareReplanAlternatives(c.state,{...c.request,newLaborSupport:false},[{id:'keep',label:'기존 확정 유지'}],c.weather,c.asOf);
 expect(existing.results[0].metrics).toMatchObject({preferredDistanceDays:0,supportPersonMinutes:240});
 c.state.missions[0].laborSupportIds=[];
 const restricted=await compareReplanAlternatives(c.state,{...c.request,newLaborSupport:false},[{id:'no-override',label:'제약 유지',newLaborSupport:true}],c.weather,c.asOf);
 expect(restricted.results[0].metrics).toMatchObject({preferredDistanceDays:1,supportPersonMinutes:0});
});
