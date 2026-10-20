import {it,expect,vi} from 'vitest';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal,jointModelInput,jointSourceHash,type JointSnapshot,type JointEvaluation} from '../lib/integrated-plan';
import {adviseJointPlan,groundJointSelection} from '../lib/integrated-plan-adviser';
import {optionEconomics} from '../lib/integrated-plan-economics';
import {dispatchPlacementKey} from '../lib/annual-dispatch';
import {validateRequest} from '../lib/ai-budget';
import {coordinationPolicySchema,type ProductionContribution} from '../lib/production-coordination';
import {economicScenarioEvidence as evidence,scenarioTriple as triple,economicScenarioReference as reference,economicScenarioSource as source,pricedEconomicScenarioSource,economicScenarioProposal as choose} from './integrated-economics-fixture';
const placements=(e:JointEvaluation)=>e.views.flatMap(v=>v.view.items.filter(i=>i.proposal).map(i=>({center:v.centerId,pnu:i.pnu,crop:i.proposal!.cultivation.crop,placement:dispatchPlacementKey(i.proposal!.dispatch.assignments)}))).sort((a,b)=>a.center.localeCompare(b.center)||a.pnu.localeCompare(b.pnu));

it('connects source scenarios while keeping unregistered operating prices out of comparable field economics',async()=>{
 const s=source(),before=structuredClone(s),snap=await collectJointSnapshot([s],['demo']);
 expect(snap.fields).toHaveLength(2);
 const potato=await evaluateJointProposal(snap,choose(snap,'potato')),pepper=await evaluateJointProposal(snap,choose(snap,'pepper'));
 expect(potato.metrics).toMatchObject({assessedEconomicsFields:0,unassessedEconomicsFields:2,baseBalanceWon:null,unfavorableBalanceWon:null});
 expect(pepper.economics.reduce((n,e)=>n+e.assessment.revenue!.base,0)).toBeGreaterThan(potato.economics.reduce((n,e)=>n+e.assessment.revenue!.base,0));
 expect(pepper.metrics.personHours).toBeGreaterThan(potato.metrics.personHours);
 expect(pepper.metrics.baseBalanceWon).toBeNull();
 for(const result of [potato,pepper])for(const e of result.economics){
  expect(e.assessment.costCoverage).toBe('REFERENCE_TOTAL_ONLY');
  expect(e.assessment.missingComponents).toEqual(expect.arrayContaining(['OPERATOR_LABOR_POLICY_REQUIRED:2027','REGISTERED_EQUIPMENT_RATE_REQUIRED']));
 }
 expect(potato.metrics.missingTasks).toBe(0);expect(pepper.metrics.missingTasks).toBe(0);expect(s).toEqual(before);
 const model=JSON.stringify(jointModelInput(snap,potato));
 for(const forbidden of ['PRIVATE',evidence.sourceUrl,evidence.method,s.fields[0].pnu])expect(model).not.toContain(forbidden);
 expect(model).toContain('OPERATOR_LABOR_POLICY_REQUIRED:2027');expect(model).toContain('REGISTERED_EQUIPMENT_RATE_REQUIRED');
});

it('connects a price and cost reference through the saved commodity without inventing a supply target',async()=>{
 const s=source('demo',1);s.coordination.policy.yields=[];
 const ref=s.coordination.policy.economicReferences!.find(r=>r.crop==='potato')!;ref.commodity='FRESH_SPRING_POTATO';ref.price.stage='WHOLESALE';
 const snap=await collectJointSnapshot([s],['demo']),candidate=snap.fields[0].options.find(o=>o.crop==='potato')!;
 expect(candidate.coordination?.production.commodity).toBeNull();
 const result=optionEconomics(s,candidate);expect(result.status).toBe('PARTIAL');expect(result.reference?.version).toBe(ref.version);expect(result.knownCost?.base).toBe(1000000);expect(result.revenue).toBeNull();expect(result.comparable).toBe(false);expect(result.missingComponents).toContain('FARM_GATE_PRICE_REQUIRED_WHOLESALE_IS_NOT_RECEIPTS');
 const evaluated=await evaluateJointProposal(snap,choose(snap,'potato'));expect(JSON.stringify(jointModelInput(snap,evaluated))).toContain('FARM_GATE_PRICE_REQUIRED_WHOLESALE_IS_NOT_RECEIPTS');expect(s.coordination.policy.targets).toEqual([]);
});

it('keeps actual field, source, candidate and proposal-order permutations equivalent',async()=>{
 const first=source('demo',2),second=source('janggye',2);
 // Interleave receipt times so both centers remain represented if bounded
 // context cuts this four-field fixture. No source is an implicit first winner.
 for(const [index,s] of [first,second].entries())for(const [i,p] of s.participations.entries())p.receivedAt=`2026-10-01T0${i*2+index}:00:00Z`;
 for(const s of [first,second])s.coordination.policy.targets=[{...evidence,commodity:'TEST_FRESH_POTATO',year:2027,origin:'DEMO',kg:1000}];
 first.fields[0].area=500;first.fields[1].area=3000;second.fields[0].area=1500;second.fields[1].area=750;
 const sources=[first,second],before=structuredClone(sources),snap=await collectJointSnapshot(sources,['demo','janggye']);
 expect(new Set(snap.fields.map(f=>f.centerId)).size).toBe(2);
 const base=await evaluateJointProposal(snap,choose(snap,'potato'));
 expect(base.metrics.supplyRiskFields).toBe(snap.fields.length);
 const changed=structuredClone(sources).reverse();
 for(const s of changed){s.fields.reverse();s.participations.reverse();s.contacts.reverse();s.criteria.profiles.reverse();s.coordination.policy.economicReferences!.reverse();s.coordination.policy.yields.reverse();}
 const next=await collectJointSnapshot(changed,['janggye','demo']);
 next.fields.reverse();next.fields.forEach(f=>f.options.reverse());
 const proposed=choose(next,'potato');proposed.choices.reverse();
 const other=await evaluateJointProposal(next,proposed);
 expect(other.metrics).toEqual(base.metrics);expect(other.totals).toEqual(base.totals);expect(placements(other)).toEqual(placements(base));
 expect(next.fields.map(f=>[f.centerId,f.pnu]).sort()).toEqual(snap.fields.map(f=>[f.centerId,f.pnu]).sort());
 const selectedCrops=(snapshot:JointSnapshot)=>jointRuleProposal(snapshot).choices.map(c=>{const f=snapshot.fields.find(f=>f.id===c.field)!;return [f.centerId,f.pnu,f.options.find(o=>o.id===c.option)!.crop];}).sort();
 expect(selectedCrops(next)).toEqual(selectedCrops(snap));expect(sources).toEqual(before);
});

it('counts shared committed production once across batches and rejects disagreeing center snapshots',async()=>{
 const a=source('demo',1),b=source('janggye',1),committed:ProductionContribution={id:'existing-cultivation',centerId:'demo',crop:'potato',areaM2:100,year:2027,commodity:'TEST_FRESH_POTATO',kg:{low:100,high:150},origin:'DEMO',basis:'SYNTHETIC ONLY'};
 a.coordination.contributions=[committed];b.coordination.contributions=[structuredClone(committed)];
 const snap=await collectJointSnapshot([a,b],['demo','janggye']),evaluated=await evaluateJointProposal(snap,choose(snap,'potato'));
 expect(evaluated.totals).toEqual([{commodity:'TEST_FRESH_POTATO',year:2027,origin:'DEMO',kg:{low:1900,high:2350},cultivations:3}]);
 b.coordination.contributions[0].kg!.high++;
 const stale=await collectJointSnapshot([a,b],['demo','janggye']);
 await expect(evaluateJointProposal(stale,choose(stale,'potato'))).rejects.toThrow('센터별 기준');
});

it('does not turn incomplete market evidence into comparable economic safety',async()=>{
 const s=source('demo',1),snap=await collectJointSnapshot([s],['demo']),candidate=snap.fields[0].options.find(o=>o.crop==='potato')!;
 const patches=[
  ()=>[],
  ()=>[{...reference('potato'),validUntil:'2026-10-02'}],
  ()=>[{...reference('potato'),harvestPeriod:{from:'2027-12-01',to:'2027-12-31'}}],
  ()=>[{...reference('potato'),commodity:'UNMATCHED_POTATO_BASIS'}],
  ()=>[{...reference('potato'),price:{...reference('potato').price,stage:'WHOLESALE' as const}}],
 ];
 for(const patch of patches){
  s.coordination.policy.economicReferences=patch();
  expect(optionEconomics(s,candidate).comparable).toBe(false);
  const next=await collectJointSnapshot([s],['demo']),result=await evaluateJointProposal(next,choose(next,'potato'));
  expect(result.metrics).toMatchObject({assessedEconomicsFields:0,unassessedEconomicsFields:1,unfavorableBalanceWon:null,baseBalanceWon:null});
 }
});

it('excludes a locally established specialty when the actual field climate is unsuitable',async()=>{
 const s=source('demo',1);s.fields[0].conditions!.climate.pepper='unsuitable';
 s.coordination.policy.specialties=[{...evidence,centerId:'demo',crop:'pepper',status:'ESTABLISHED',bonus:5}];
 const before=structuredClone(s),snap=await collectJointSnapshot([s],['demo']);
 expect(snap.fields[0].options.map(o=>o.crop)).toEqual(['potato']);
 const result=await evaluateJointProposal(snap,jointRuleProposal(snap));expect(result.mix.map(m=>m.crop)).toEqual(['potato']);expect(result.metrics.establishedSpecialtyFields).toBe(0);expect(s).toEqual(before);
});

it('blocks apparently cheap statistical costs below the known wages for executable work',async()=>{
 const s=source('demo',1);const ref=s.coordination.policy.economicReferences!.find(r=>r.crop==='pepper')!;
 if(ref.cost.mode!=='STATISTICAL_TOTAL')throw Error('fixture');ref.cost.totalWonPer1000m2=triple(1);
 const snap=await collectJointSnapshot([s],['demo']),result=await evaluateJointProposal(snap,choose(snap,'pepper'));
 expect(result.metrics.missingTasks).toBe(0);expect(result.metrics.baseBalanceWon).toBeNull();
 expect(result.economics[0].assessment.missingComponents).toContain('STATISTICAL_TOTAL_BELOW_KNOWN_OPERATIONAL_COST');
 expect(result.economics[0].assessment.knownCost).toEqual(triple(1));
});

it('uses real scheduled half-day labor quotes for a manual cost scenario and never infers operator wages',async()=>{
 const s=source('demo',1),snap=await collectJointSnapshot([s],['demo']),candidate=structuredClone(snap.fields[0].options.find(o=>o.crop==='potato')!);
 const ref=s.coordination.policy.economicReferences!.find(r=>r.crop==='potato')!;
 ref.cost={mode:'ITEMIZED',coverage:'ALL_OTHER_COSTS_REVIEWED',components:[{...evidence,version:'fixture-materials',category:'SEED_MATERIALS',wonPer1000m2:triple(10000)}]};
 // This artificial manual workload is a calculator fixture, not an executable
 // farming alternative. Actual option generation/feasibility is tested above.
 for(const plot of candidate.plan.plan.plots)for(const task of plot.tasks){task.requirements.machineCode=null;task.requirements.requiresOperator=false;task.requirements.staff=1;task.requirements.owner='농부';}
 candidate.plan.dispatch.assignments.forEach(a=>{a.machineId=null;a.durationMinutes=241;});
 const result=optionEconomics(s,candidate),required=candidate.plan.plan.plots.flatMap(p=>p.tasks.filter(t=>t.kind==='PROCESS'||t.kind==='REPEAT')).length;
 expect(result.comparable).toBe(true);expect(result.operationalCost.ordinaryLabor).toBe(required*100000);
 expect(result.knownCost!.base).toBe(required*100000+10000);
 const costly=structuredClone(snap.fields[0].options.find(o=>o.crop==='pepper')!),pepperRef=s.coordination.policy.economicReferences!.find(r=>r.crop==='pepper')!;
 pepperRef.cost=structuredClone(ref.cost);
 for(const plot of costly.plan.plan.plots)for(const task of plot.tasks){task.requirements.machineCode=null;task.requirements.requiresOperator=false;task.requirements.staff=10;task.requirements.owner='농부';}
 costly.plan.dispatch.assignments.forEach(a=>{a.machineId=null;a.durationMinutes=241;});
 const laborIntensive=optionEconomics(s,costly);
 expect(laborIntensive.comparable).toBe(true);expect(laborIntensive.revenue!.base).toBeGreaterThan(result.revenue!.base);expect(laborIntensive.metrics.baseBalanceWon!).toBeLessThan(result.metrics.baseBalanceWon!);
 const realCandidate=snap.fields[0].options.find(o=>o.crop==='potato')!,actual=optionEconomics(s,realCandidate);
 expect(actual.comparable).toBe(false);expect(actual.missingComponents).toContain('OPERATOR_LABOR_POLICY_REQUIRED:2027');expect(actual.missingComponents).toContain('REGISTERED_EQUIPMENT_RATE_REQUIRED');
});

it('shows economic gaps while a model revises and selects with known workload metrics under 16KB',async()=>{
 const s=source(),snap=await collectJointSnapshot([s],['demo']),baseline=await evaluateJointProposal(snap,jointRuleProposal(snap));
 let calls=0;const sizes:number[]=[],observed:number[]=[];
 const complete=vi.fn(async(body:Record<string,unknown>)=>{
  validateRequest(body,'planning');sizes.push(Buffer.byteLength(JSON.stringify(body),'utf8'));calls++;
  const messages=body.messages as any[],last=messages.at(-1),result=last.role==='tool'?JSON.parse(last.content):null;
  if(result){observed.push(result.metrics.personHours);expect(result.metrics.baseBalanceWon).toBeNull();expect(result.metrics.unassessedEconomicsFields).toBe(snap.fields.length);}
  const done=calls===3,args=done?{evaluationId:result.id,assessments:Object.fromEntries(result.evaluatedIds.map((id:string)=>[id,id===result.id?'unassessedEconomicsFields':'personHours']))}:{...choose(snap,calls===1?'pepper':'potato'),choices:Object.fromEntries(choose(snap,calls===1?'pepper':'potato').choices.map(c=>[c.field,c.option]))};
  return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'economic-step-'+calls,function:{name:done?'select_plan':'evaluate_plan',arguments:JSON.stringify(args)}}]}}]};
 });
 const result=await adviseJointPlan(snap,baseline,complete);
 expect(result.contract).toBe('joint-crop-resources-v6');expect(calls).toBe(3);expect(result.selected.mix.map(m=>m.crop)).toEqual(['potato']);
 expect(result.selected.id).toBe(baseline.id); // A real contract comparison may correctly select the unchanged baseline.
 expect(observed[1]).toBeLessThan(observed[0]);expect(result.evidence.evidence).toEqual([{metric:'unassessedEconomicsFields',value:snap.fields.length}]);
 expect(result.evidence.tradeoffs).toHaveLength(1);expect(result.evidence.tradeoffs[0].selected).toBeLessThan(result.evidence.tradeoffs[0].alternative);
 expect(Math.max(...sizes)).toBeLessThanOrEqual(16000);expect(result.selected.reserved).toBe(false);expect(result.usage).toEqual([]);
});

it('rejects a model monetary selection reference when an economic input is unknown',async()=>{
 const s=source('demo',1);s.coordination.policy.economicReferences=[];
 const snap=await collectJointSnapshot([s],['demo']),result=await evaluateJointProposal(snap,choose(snap,'potato'));
 expect(()=>groundJointSelection({evaluationId:'E0',evidence:['baseBalanceWon'],tradeoffs:[]},new Map([[result.id,result]]),new Map([['E0',result.id]]))).toThrow();
});

it('compares actual common-engine placements only when ordinary, operator and equipment prices are explicitly present',async()=>{
 const s=pricedEconomicScenarioSource(),before=structuredClone(s),snap=await collectJointSnapshot([s],['demo']);
 const potato=await evaluateJointProposal(snap,choose(snap,'potato')),pepper=await evaluateJointProposal(snap,choose(snap,'pepper'));
 expect(potato.metrics).toMatchObject({assessedEconomicsFields:2,unassessedEconomicsFields:0,baseBalanceWon:6000000,unfavorableBalanceWon:3400000,missingTasks:0});
 expect(pepper.metrics).toMatchObject({assessedEconomicsFields:2,unassessedEconomicsFields:0,baseBalanceWon:2000000,unfavorableBalanceWon:-1000000,missingTasks:0});
 for(const result of [potato,pepper])for(const e of result.economics){
  expect(e.assessment.operationalCost.operatorLabor).toBeGreaterThan(0);expect(e.assessment.operationalCost.equipment).toBeGreaterThan(0);
  expect(e.assessment.operationalCost.additive).toBe(false);expect(e.assessment.missingComponents).toEqual([]);
 }
 expect(pepper.economics[0].assessment.revenue!.base).toBeGreaterThan(potato.economics[0].assessment.revenue!.base);
 expect(pepper.metrics.personHours).toBeGreaterThan(potato.metrics.personHours);expect(pepper.metrics.baseBalanceWon!).toBeLessThan(potato.metrics.baseBalanceWon!);expect(s).toEqual(before);
 const fingerprint=jointSourceHash([s],['demo']);s.coordination.policy.operatorCostRates![0].hourlyWon++;
 expect(jointSourceHash([s],['demo'])).not.toBe(fingerprint);
});

it('prices actual itemized labor so the more expensive crop can lose its apparent margin',async()=>{
 const s=pricedEconomicScenarioSource('demo',1);
 s.laborPayByYear!['2027']={...s.laborPayByYear!['2027'],hourlyWon:50000,halfDayWon:200000};
 for(const r of s.coordination.policy.economicReferences!){
  r.price={...r.price,...triple(r.crop==='potato'?4000:4100)};
  r.cost={mode:'ITEMIZED',coverage:'ALL_OTHER_COSTS_REVIEWED',components:[{...evidence,version:'synthetic-materials-v1',category:'SEED_MATERIALS',wonPer1000m2:triple(100000)}]};
 }
 const snap=await collectJointSnapshot([s],['demo']),potato=await evaluateJointProposal(snap,choose(snap,'potato')),pepper=await evaluateJointProposal(snap,choose(snap,'pepper'));
 expect(potato.metrics.assessedEconomicsFields).toBe(1);expect(pepper.metrics.assessedEconomicsFields).toBe(1);
 expect(pepper.economics[0].assessment.revenue!.base).toBeGreaterThan(potato.economics[0].assessment.revenue!.base);
 expect(pepper.economics[0].assessment.operationalCost.ordinaryLabor!).toBeGreaterThan(potato.economics[0].assessment.operationalCost.ordinaryLabor!);
 expect(pepper.metrics.baseBalanceWon!).toBeLessThan(potato.metrics.baseBalanceWon!);
});

it('requires the operator rate to cover the task year, every operator work date, center and data origin',async()=>{
 const initial=pricedEconomicScenarioSource('demo',1),snap=await collectJointSnapshot([initial],['demo']),candidate=snap.fields[0].options.find(o=>o.crop==='potato')!;
 expect(optionEconomics(initial,candidate).comparable).toBe(true);
 for(const patch of [{year:2028},{validUntil:'2026-12-31'},{validUntil:'2027-03-15'},{centerId:'janggye'},{origin:'REGISTERED' as const},{checkedOn:'2026-10-17'}]){
  const s=structuredClone(initial);Object.assign(s.coordination.policy.operatorCostRates![0],patch);
  const result=optionEconomics(s,candidate);expect(result.comparable).toBe(false);expect(result.metrics.baseBalanceWon).toBeNull();expect(result.missingComponents).toContain('OPERATOR_LABOR_POLICY_REQUIRED:2027');
 }
 const noOrdinary=structuredClone(initial);delete noOrdinary.laborPayByYear;
 expect(optionEconomics(noOrdinary,candidate)).toMatchObject({comparable:false,costCoverage:'REFERENCE_TOTAL_ONLY',metrics:{baseBalanceWon:null}});
 const duplicate=structuredClone(initial);duplicate.coordination.policy.operatorCostRates!.push(duplicate.coordination.policy.operatorCostRates![0]);
 expect(coordinationPolicySchema.safeParse(duplicate.coordination.policy).success).toBe(false);
});

it('grounds a model economic revision on explicit priced work without inventing an improvement over the baseline',async()=>{
 const s=pricedEconomicScenarioSource(),snap=await collectJointSnapshot([s],['demo']),baseline=await evaluateJointProposal(snap,jointRuleProposal(snap));
 let calls=0;const sizes:number[]=[],balances:number[]=[];
 const complete=vi.fn(async(body:Record<string,unknown>)=>{
  validateRequest(body,'planning');sizes.push(Buffer.byteLength(JSON.stringify(body),'utf8'));calls++;
  const last=(body.messages as any[]).at(-1),result=last.role==='tool'?JSON.parse(last.content):null;
  if(result){expect(typeof result.metrics.baseBalanceWon).toBe('number');balances.push(result.metrics.baseBalanceWon);}
  const done=calls===3,args=done?{evaluationId:result.id,assessments:Object.fromEntries(result.evaluatedIds.map((id:string)=>[id,'baseBalanceWon']))}:{staffing:'CORE_AND_PEAK',choices:Object.fromEntries(choose(snap,calls===1?'pepper':'potato').choices.map(c=>[c.field,c.option]))};
  return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'priced-step-'+calls,function:{name:done?'select_plan':'evaluate_plan',arguments:JSON.stringify(args)}}]}}]};
 });
 const result=await adviseJointPlan(snap,baseline,complete);
 expect(calls).toBe(3);expect(balances[1]).toBeGreaterThan(balances[0]);expect(result.selected.id).toBe(baseline.id);
 expect(result.evidence.evidence).toEqual([{metric:'baseBalanceWon',value:result.selected.metrics.baseBalanceWon}]);
 expect(result.evidence.tradeoffs[0].metric).toBe('baseBalanceWon');expect(result.evidence.tradeoffs[0].selected).toBeGreaterThan(result.evidence.tradeoffs[0].alternative);
 expect(Math.max(...sizes)).toBeLessThanOrEqual(16000);expect(result.usage).toEqual([]);expect(result.selected.reserved).toBe(false);
});
