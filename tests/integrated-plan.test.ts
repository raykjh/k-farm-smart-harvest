import {it,expect,vi} from 'vitest';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal,jointModelInput,staffingPlan,validateJointProposal,assertCrossCenterPeople,jointSourceHash} from '../lib/integrated-plan';
import {adviseJointPlan,verifyJointSelection,groundJointSelection,groundJointAssessment,jointWireTools,decodeJointChoices,jointComparisonRows} from '../lib/integrated-plan-adviser';
import {jointPublicView} from '../lib/integrated-plan-service';
import {equipmentWindowBound} from '../lib/integrated-resource-demand';
import {permitted} from '../lib/auth-policy';
import {jointSource,fakeJointCompletion} from './integrated-plan-fixture';
import {validateRequest} from '../lib/ai-budget';
import {jointDecisionContext} from '../lib/integrated-plan-context';
import {parcelBoundarySchema} from '../lib/parcel-boundary';

it('compares the crop mix with actual common dispatch and leaves all source data unchanged',async()=>{
 const source=jointSource(),before=structuredClone(source),snapshot=await collectJointSnapshot([source],['demo']);
 expect(snapshot.fields).toHaveLength(2);expect(snapshot.fields[0].options).toHaveLength(2);
 const baseline=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot)),completion=vi.fn(fakeJointCompletion);
 const ai=await adviseJointPlan(snapshot,baseline,completion);
 expect(completion).toHaveBeenCalledTimes(2);expect(ai.selected.status).toBe('REVIEW_READY');expect(ai.selected.metrics.readyFields).toBe(2);
 expect(JSON.stringify(completion.mock.calls[0])).toContain('EVERY evaluated ID as a required key');
 expect(ai.contract).toBe('joint-crop-resources-v5');
 expect(ai.evidenceOrigin).toBe('SERVER_METRIC_REFERENCES_V1');expect(ai.modelReferences.evidence).toEqual(['missingTasks']);
 expect(ai.selected.mix).toHaveLength(2);expect(ai.selected.metrics.largestCropShare).toBe(.5);expect(baseline.metrics.largestCropShare).toBe(1);
 expect(ai.selected.metrics.meanSuitability).toBe(baseline.metrics.meanSuitability);expect(ai.selected.metrics.personHours).toBeGreaterThan(baseline.metrics.personHours);
 expect(source).toEqual(before);expect(ai.selected.reserved).toBe(false);expect(ai.selected.costEstimate).toBeNull();
 const evaluated=new Map([[baseline.id,baseline],[ai.selected.id,ai.selected]]),refs=new Map([['E0',baseline.id],['E1',ai.selected.id]]);
 const rows=jointComparisonRows(evaluated,refs);
 for(const [selectedRef,id] of refs){const row=rows[selectedRef][0],other=evaluated.get(refs.get(row.evaluationId)!)!;expect(row.selected).toBe(evaluated.get(id)!.metrics[row.metric]);expect(row.alternative).toBe(other.metrics[row.metric]);}
 const model=JSON.stringify(jointModelInput(snapshot,baseline));for(const secret of ['PRIVATE NAME','PRIVATE PHONE','PRIVATE ADDRESS','PRIVATE REVIEW',source.fields[0].pnu])expect(model).not.toContain(secret);
});
it('keeps crop options even when resources are missing, but never declares them executable',async()=>{
 const source=jointSource();source.state!.machines=[];source.state!.staffCount=0;
 const snapshot=await collectJointSnapshot([source],['demo']);expect(snapshot.fields).toHaveLength(2);
 const result=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));
 expect(result.status).toBe('RESOURCE_REQUIRED');expect(result.metrics.readyFields).toBe(0);expect(result.requests.length).toBeGreaterThan(0);
 expect(result.views[0].view.items.every(i=>!i.proposal)).toBe(true);expect(result.unknowns).toContain('UNSCHEDULED_DEMAND_EXCLUDED_FROM_STAFFING_TOTAL');
 expect(result.equipment.every(e=>e.minimumUnits===null)).toBe(true);
});
it('rejects invented fields, duplicated crop choices and model factual errors without paid retries',async()=>{
 const snapshot=await collectJointSnapshot([jointSource()],['demo']),proposal=jointRuleProposal(snapshot),base=await evaluateJointProposal(snapshot,proposal);
 expect(()=>validateJointProposal(snapshot,{...proposal,choices:[proposal.choices[0],proposal.choices[0]]})).toThrow('농지마다');
 expect(()=>validateJointProposal(snapshot,{...proposal,choices:proposal.choices.map(c=>({...c,option:'O9999'}))})).toThrow('후보');
 expect(()=>verifyJointSelection({evaluationId:base.id,evidence:[{metric:'missingTasks',value:99}],tradeoffs:[]},new Map([[base.id,base]]))).toThrow('계산값');
 expect(()=>verifyJointSelection({evaluationId:base.id,evidence:Array.from({length:6},()=>({metric:'missingTasks',value:base.metrics.missingTasks})),tradeoffs:[]},new Map([[base.id,base]]))).toThrow();
 const fail=vi.fn(async()=>({choices:[]}));await expect(adviseJointPlan(snapshot,base,fail)).rejects.toThrow('형식');expect(fail).toHaveBeenCalledOnce();
});
it('binds model-selected metric references to exact values without accepting copied or invented numbers',async()=>{
 const snap=await collectJointSnapshot([jointSource()],['demo']),base=await evaluateJointProposal(snap,jointRuleProposal(snap));
 const exact={...base,metrics:{...base.metrics,largestCropShare:10/11}};
 const evaluated=new Map([[exact.id,exact]]),refs=new Map([['E0',exact.id]]);
 const selection={evaluationId:'E0',evidence:['largestCropShare','missingTasks'],tradeoffs:[]};
 const bound=groundJointSelection(selection,evaluated,refs);
 expect(bound.chosen.id).toBe(exact.id);expect(bound.decision.evidence[0].value).toBe(10/11);
 expect(bound.references).toEqual(selection);
 expect(()=>groundJointSelection({...selection,evidence:[{metric:'largestCropShare',value:0.91}]},evaluated,refs)).toThrow();
 expect(()=>groundJointSelection({...selection,evaluationId:'E3'},evaluated,refs)).toThrow('참조');
 expect(()=>groundJointSelection({...selection,evidence:['missingTasks','missingTasks']},evaluated,refs)).toThrow('중복');
 expect(()=>groundJointSelection({...selection,evidence:['inventedProfit']},evaluated,refs)).toThrow();
 const other={...exact,id:'f'.repeat(64),metrics:{...exact.metrics,missingTasks:1,readyFields:0}};
 evaluated.set(other.id,other);refs.set('E1',other.id);
 expect(()=>groundJointSelection(selection,evaluated,refs)).toThrow('누락');
 const valid={...selection,tradeoffs:[{evaluationId:'E1',metric:'missingTasks'}]};
 expect(groundJointSelection(valid,evaluated,refs).decision.tradeoffs[0]).toEqual({evaluationId:other.id,metric:'missingTasks',selected:0,alternative:1});
 expect(()=>groundJointSelection({...valid,tradeoffs:[...valid.tradeoffs,...valid.tradeoffs]},evaluated,refs)).toThrow('누락');
 expect(()=>groundJointSelection({...selection,evaluationId:'E1',tradeoffs:[{evaluationId:'E0',metric:'missingTasks'}]},evaluated,refs)).toThrow('필수 작업');
});
it('requires one named choice per field in the actual model schema, without filling missing choices from rules',async()=>{
 const snapshot=await collectJointSnapshot([jointSource('demo',3)],['demo']),proposal=jointRuleProposal(snapshot);
 const schema=jointWireTools(snapshot)[0].function.parameters.properties.choices;
 expect(schema.type).toBe('object');expect(schema.required).toEqual(snapshot.fields.map(f=>f.id));expect(schema.additionalProperties).toBe(false);
 for(const f of snapshot.fields)expect(schema.properties[f.id].enum).toEqual(f.options.map(o=>o.id));
 const choices=Object.fromEntries(proposal.choices.map(c=>[c.field,c.option]));
 expect(decodeJointChoices(snapshot,{choices,staffing:proposal.staffing})).toEqual(proposal);
 const missing={...choices};delete missing[snapshot.fields[0].id];
 expect(()=>decodeJointChoices(snapshot,{choices:missing,staffing:proposal.staffing})).toThrow('누락');
 expect(()=>decodeJointChoices(snapshot,{choices:{...missing,F999:'O1'},staffing:proposal.staffing})).toThrow('누락');
 expect(()=>decodeJointChoices(snapshot,proposal)).toThrow();
 const completion=vi.fn(async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'missing',function:{name:'evaluate_plan',arguments:JSON.stringify({choices:missing,staffing:proposal.staffing})}}]}}]}));
 const baseline=await evaluateJointProposal(snapshot,proposal);
 await expect(adviseJointPlan(snapshot,baseline,completion)).rejects.toThrow('누락');expect(completion).toHaveBeenCalledOnce();
});
it('requires every evaluated ID in the live selection schema and preserves tied comparisons',async()=>{
 const snap=await collectJointSnapshot([jointSource()],['demo']),base=await evaluateJointProposal(snap,jointRuleProposal(snap));
 for(let count=1;count<=4;count++){
  const alternatives=Array.from({length:count},(_,i)=>({...base,id:String(i+1).repeat(64)}));
  const evaluated=new Map(alternatives.map(e=>[e.id,e])),refs=new Map(alternatives.map((e,i)=>[`E${i}`,e.id]));
  const schema=jointWireTools(snap,refs.keys())[1].function.parameters;
  expect(schema.required).toEqual(['evaluationId','assessments']);expect(schema.properties.evaluationId.enum).toEqual([...refs.keys()]);
  expect(schema.properties.assessments.required).toEqual([...refs.keys()]);expect(schema.properties.assessments.additionalProperties).toBe(false);
  for(const selected of refs.keys()){
   const assessments=Object.fromEntries([...refs.keys()].map(id=>[id,id===selected?'readyFields':'missingTasks']));
   const result=groundJointAssessment({evaluationId:selected,assessments},evaluated,refs);
   expect(result.references.evidence).toEqual(['readyFields']);expect(result.decision.tradeoffs).toHaveLength(count-1);
   expect(result.decision.tradeoffs.every(t=>t.selected===t.alternative)).toBe(true);
   const missing={...assessments};delete missing[[...refs.keys()][0]];
   expect(()=>groundJointAssessment({evaluationId:selected,assessments:missing},evaluated,refs)).toThrow('누락');
   expect(()=>groundJointAssessment({evaluationId:selected,assessments:{...assessments,E9:'missingTasks'}},evaluated,refs)).toThrow();
   expect(()=>groundJointAssessment({evaluationId:selected,assessments:{...assessments,[selected]:123}},evaluated,refs)).toThrow();
   expect(()=>groundJointAssessment({evaluationId:selected,assessments:{...assessments,[selected]:'inventedProfit'}},evaluated,refs)).toThrow();
  }
 }
});
it('does not repair missing model assessments or retry a rejected selection',async()=>{
 const snap=await collectJointSnapshot([jointSource()],['demo']),base=await evaluateJointProposal(snap,jointRuleProposal(snap));
 const complete=vi.fn(async(body:Record<string,unknown>)=>{
  const response=await fakeJointCompletion(body),call=response.choices[0].message.tool_calls[0];
  if(call.function.name==='select_plan')call.function.arguments=JSON.stringify({evaluationId:'E0',assessments:{}});
  return response;
 });
 await expect(adviseJointPlan(snap,base,complete)).rejects.toThrow('누락');expect(complete).toHaveBeenCalledTimes(2);
 const other={...base,id:'f'.repeat(64),metrics:{...base.metrics,missingTasks:1,readyFields:0}},evaluated=new Map([[base.id,base],[other.id,other]]),refs=new Map([['E0',base.id],['E1',other.id]]);
 expect(()=>groundJointAssessment({evaluationId:'E1',assessments:{E0:'missingTasks',E1:'readyFields'}},evaluated,refs)).toThrow('필수 작업');
 expect(()=>groundJointAssessment({evaluationId:'E3',assessments:{E0:'missingTasks',E1:'readyFields'}},evaluated,refs)).toThrow('참조');
});
it('excludes unconsented fields and future approved cycles instead of overwriting them',async()=>{
 const source=jointSource();source.contacts[0].payload.consent=false;
 const snapshot=await collectJointSnapshot([source],['demo']);expect(snapshot.fields).toHaveLength(1);expect(snapshot.excluded[0].count).toBe(1);
 const result=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));source.cycles.push(result.views[0].view.items.find(i=>i.proposal)!.proposal!.cultivation);
 expect((await collectJointSnapshot([source],['demo'])).fields).toHaveLength(0);
});
it('calculates sustained, peak, reserve and four-hour labor separately; zero-demand weeks matter',()=>{
 const rows=Array.from({length:8},(_,i)=>({centerId:'demo',date:new Date(Date.parse('2026-10-19')+i*7*86400000).toISOString().slice(0,10),machineCode:null,machineHours:0,laborHours:i===7?120:40,operatorHours:0,transportHours:0}));
 const core=staffingPlan(rows,'demo','2026-10-19','2026-12-13','CORE_AND_PEAK'),peak=staffingPlan(rows,'demo','2026-10-19','2026-12-13','PEAK_ONLY');
 expect(core.contractWorkers).toBe(1);expect(core.dailyPersonShifts).toBe(20);expect(core.reserveWorkers).toBe(1);expect(peak.dailyPersonShifts).toBe(100);
 expect(staffingPlan(rows,'demo','2026-01-01','2026-12-31','CORE_AND_PEAK').contractWorkers).toBe(0);
 expect(equipmentWindowBound([{from:'2026-10-19',to:'2026-10-19',hours:12}])).toBe(2);
 expect(equipmentWindowBound([{from:'2026-10-19',to:'2026-10-19',hours:null}])).toBeNull();
});
it('rejects a named operator or confirmed support worker used by two centers at once',()=>{
 const row={centerId:'demo',date:'2027-05-01',startMinute:480,durationMinutes:60,operatorIds:['operator-1']};
 expect(()=>assertCrossCenterPeople([row,{...row,centerId:'janggye'}])).toThrow('중복');
 expect(()=>assertCrossCenterPeople([row,{...row,centerId:'janggye',startMinute:540}])).not.toThrow();
 expect(()=>assertCrossCenterPeople([{...row,operatorIds:[],laborSupportIds:['support-1']},{...row,centerId:'janggye',operatorIds:[],laborSupportIds:['support-1']}])).toThrow('중복');
 const source=jointSource();source.state!.laborCapacity={incoming:[],outgoing:[{id:'offer-a',ownerCenterId:'demo',workerId:'worker-1',travelMinutes:30},{id:'offer-b',ownerCenterId:'demo',workerId:'worker-1',travelMinutes:30}] as any};
 const supported={...row,operatorIds:[],laborSupportIds:['offer-a']};
 expect(()=>assertCrossCenterPeople([supported,{...supported,centerId:'janggye',startMinute:570,laborSupportIds:['offer-b']}],[source])).toThrow('중복');
 expect(()=>assertCrossCenterPeople([supported,{...supported,centerId:'janggye',startMinute:600,laborSupportIds:['offer-b']}],[source])).not.toThrow();
});
it('uses the same four-center constraints; no private field details leak in the aggregate response',async()=>{
 const sources=['demo','janggye','cheoncheon','gyenam'].map(id=>jointSource(id,1)),snapshot=await collectJointSnapshot(sources,sources.map(s=>s.scopeId));
 const selected=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));expect(selected.metrics.readyFields).toBe(4);expect(selected.staffing).toHaveLength(4);
 const view=JSON.stringify(jointPublicView({input:{requestId:'test',audience:'network'},selected,baseline:selected,source:'RULES',status:'READY'}));
 expect(view).not.toContain('PRIVATE');expect(view).not.toContain('consultation');expect(view).not.toContain(sources[0].fields[0].pnu);
 const p={id:'test',username:'test',name:'test',role:'CENTER_STAFF',centerId:'demo'} as any;
 expect(permitted(p,'integrated-planning','GET',null)).toBe(true);expect(permitted(p,'integrated-planning','POST',{action:'plan'})).toBe(false);
 expect(permitted({...p,role:'CENTER_ADMIN'},'integrated-planning','POST',{action:'stage'})).toBe(true);
 expect(permitted({...p,role:'SUPER_ADMIN',centerId:null},'integrated-planning','POST',{action:'stage'})).toBe(false);
});
const reviewed={sourceUrl:'https://example.com/PRIVATE-source-only',method:'PRIVATE REVIEW',checkedOn:'2026-01-01',validUntil:'2027-12-31'};
it('grounds supply, specialty and land context while rule and AI see the same facts',async()=>{
 const s=jointSource();s.coordination.policy.yields=[{crop:'potato',commodity:'TEST_POTATO',kgPer1000m2:{low:100,high:200},...reviewed},{crop:'pepper',commodity:'TEST_PEPPER',kgPer1000m2:{low:100,high:200},...reviewed}];
 s.coordination.policy.marketOutlooks=[{crop:'potato',commodity:'TEST_POTATO',from:'2027-01-01',to:'2027-12-31',pressure:'OVERSUPPLY_RISK',...reviewed},{crop:'pepper',commodity:'TEST_PEPPER',from:'2027-01-01',to:'2027-12-31',pressure:'BALANCED',...reviewed}];
 s.coordination.policy.specialties=[{centerId:'demo',crop:'pepper',status:'ESTABLISHED',bonus:3,...reviewed}];
 const snap=await collectJointSnapshot([s],['demo']),base=await evaluateJointProposal(snap,jointRuleProposal(snap));
 const model=jointModelInput(snap,base);
 expect(model.fields[0].conditions).toMatchObject({actualUse:'upland',environment:'LEGACY_UNSPECIFIED'});
 expect(model.fields[0].options.find(o=>o.crop==='potato')).toMatchObject({nationalOutlook:'OVERSUPPLY_RISK',specialty:'NOT_REVIEWED'});
 expect(model.fields[0].options.find(o=>o.crop==='pepper')).toMatchObject({nationalOutlook:'BALANCED',specialty:'ESTABLISHED'});
 expect(base.mix.map(m=>m.crop)).toEqual(['pepper']);
 expect(base.metrics).toMatchObject({supplyRiskFields:0,unassessedMarketFields:0,establishedSpecialtyFields:2});
 expect(JSON.stringify(model)).not.toContain('PRIVATE');
 expect(base.priceForecast).toBeNull();expect(base.decisionContext.priceGuarantee).toBe(false);
 const hash=jointSourceHash([s],['demo']);s.coordination.policy.marketOutlooks[0].validUntil='2026-01-01';
 expect(jointSourceHash([s],['demo'])).not.toBe(hash);
 const next=await collectJointSnapshot([s],['demo']),nextBase=await evaluateJointProposal(next,jointRuleProposal(next));
 expect(jointModelInput(next,nextBase).fields[0].options.find(o=>o.crop==='potato')?.nationalOutlook).toBe('UNKNOWN');
});
it('checks participant thresholds for the whole batch, independent of field order',async()=>{
 const s=jointSource();s.coordination.policy.yields=[{crop:'potato',commodity:'TEST_POTATO',kgPer1000m2:{low:100,high:200},...reviewed}];
 s.coordination.policy.targets=[{commodity:'TEST_POTATO',year:2027,origin:'REGISTERED',kg:300,...reviewed}];
 const snap=await collectJointSnapshot([s],['demo']),base=await evaluateJointProposal(snap,jointRuleProposal(snap));
 expect(base.metrics.supplyRiskFields).toBe(2);expect(base.metrics.unassessedMarketFields).toBe(2);
 expect(base.decisionContext.fields.every(f=>f.participantSupply==='POSSIBLE_CONCENTRATION')).toBe(true);
 const reversed={...snap,fields:[...snap.fields].reverse().map(f=>({...f,options:[...f.options].reverse()}))};
 const other=await evaluateJointProposal(reversed,jointRuleProposal(reversed));
 expect(other.metrics).toEqual(base.metrics);
 const fields=(x:typeof snap)=>jointModelInput(x,base).fields.sort((a,b)=>a.id.localeCompare(b.id)).map(f=>({...f,options:f.options.sort((a,b)=>a.id.localeCompare(b.id))}));
 expect(fields(reversed)).toEqual(fields(snap));
});
it('uses adjacent active crop periods, not parcel numbers or an old crop label, and never exports geometry',async()=>{
 const s=jointSource();
 const boundary=(x:number)=>parcelBoundarySchema.parse({source:'VWORLD',checkedOn:'2026-10-01',geometry:{type:'Polygon',coordinates:[[[x,35],[x+.001,35],[x+.001,35.001],[x,35.001],[x,35]]]}});
 s.fields[0].boundary=boundary(127);s.fields[1].boundary=boundary(127.001);
 const snap=await collectJointSnapshot([s],['demo']),proposal=jointRuleProposal(snap),base=await evaluateJointProposal(snap,proposal);
 expect(base.metrics.neighborCompatibleFields).toBe(2);
 const model=jointModelInput(snap,base);expect(model.fields[0].neighborhood.fieldIds).toEqual([snap.fields[1].id]);
 expect(JSON.stringify(model)).not.toContain('coordinates');expect(JSON.stringify(model)).not.toContain(s.fields[0].pnu);
 const mixed={...proposal,choices:proposal.choices.map((c,i)=>i?{...c,option:snap.fields[i].options.find(o=>o.crop==='pepper')!.id}:c)};
 expect((await evaluateJointProposal(snap,mixed)).metrics.neighborCompatibleFields).toBe(0);
 const selected=snap.fields.map(field=>({field,option:field.options.find(o=>o.crop==='potato')!}));
 selected[1].option=structuredClone(selected[1].option);selected[1].option.plan.cultivation.start='2028-01-01';selected[1].option.plan.cultivation.end='2028-12-01';
 expect(jointDecisionContext(snap,selected,[]).metrics.neighborCompatibleFields).toBe(0);
 delete s.fields[1].boundary;const incomplete=await collectJointSnapshot([s],['demo']);
 expect(jointModelInput(incomplete,base).fields[1].neighborhood.status).toBe('UNKNOWN');
});
it('keeps missing facility practice out of execution and never erases approved orchard or crop records',async()=>{
 const s=jointSource();s.fields[0].conditions!.growingEnvironment='unheated_greenhouse';
 const before=structuredClone(s),snapshot=await collectJointSnapshot([s],['demo']);
 expect(snapshot.fields).toHaveLength(1);expect(snapshot.excluded[0].count).toBe(1);expect(s).toEqual(before);
});
it('supports three calculator revisions within the unchanged 16KB per-call budget without paid calls',async()=>{
 const snap=await collectJointSnapshot([jointSource('demo',8)],['demo']),base=await evaluateJointProposal(snap,jointRuleProposal(snap));
 let calls=0;const sizes:number[]=[];
 const complete=vi.fn(async(body:Record<string,unknown>)=>{
  validateRequest(body,'planning');sizes.push(Buffer.byteLength(JSON.stringify(body)));calls++;
  const last=(body.messages as any[]).at(-1),result=last.role==='tool'?JSON.parse(last.content):null;
  const final=calls===4,args=final?{evaluationId:'E0',assessments:Object.fromEntries([['E0','missingTasks'],...result.comparisonRows.E0.map((r:any)=>[r.evaluationId,r.metric])])}:{...base.proposal,choices:Object.fromEntries(base.proposal.choices.map((c,i)=>[c.field,i<calls?snap.fields.find(f=>f.id===c.field)!.options.find(o=>o.crop==='pepper')!.id:c.option]))};
  return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'step-'+calls,function:{name:final?'select_plan':'evaluate_plan',arguments:JSON.stringify(args)}}]}}]};
 });
 const result=await adviseJointPlan(snap,base,complete);
 expect(result.selected.id).toBe(base.id);expect(result.alternatives).toHaveLength(3);expect(calls).toBe(4);expect(Math.max(...sizes)).toBeLessThanOrEqual(16000);
 expect(snap.remaining+snap.fields.length).toBe(8);
});
