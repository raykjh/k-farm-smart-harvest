import {it,expect,vi} from 'vitest';
import {automaticSearchSteps,runAutomaticReplan} from '../lib/automatic-replanning';
import {withManualFallback,manualWorkRequirement} from '../lib/replan-manual-fallback';
import {replacementDurationFixture} from './replacement-duration-fixture';
import {resourceCandidates} from '../lib/replan-resource-options';
import {replanResolutionNeeds} from '../lib/replan-resolution';
const weather={status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'test'} as any;
it('runs default AI review, validates once, persists commit link then applies without UI alternative selection',async()=>{
 const calls:string[]=[],checkpoint=vi.fn(async()=>{calls.push('checkpoint')});
 const invoke=vi.fn(async(b:any)=>{
  calls.push(b.action);
  if(b.action==='compare'){expect(b).toMatchObject({useAi:true,searchMode:'LOCAL_FIRST',alternatives:automaticSearchSteps});return {recommendation:{alternativeId:'adjacent',source:'NEBIUS',rationaleCheck:{status:'VERIFIED'},priorityCheck:{status:'ALIGNED'}},results:[{id:'adjacent',status:'FEASIBLE',previewRequest:{action:'preview'},result:{borrowedMachineIds:['other']}}]};}
  if(b.action==='preview')return {status:'FEASIBLE',proposalId:'p',diff:[{date:'2032-09-02'}],assignments:[{resource:'other'}]};
  return {ok:true};
 });
 const result=await runAutomaticReplan({ids:['a']},'r',invoke,true,async()=>[],checkpoint);
 expect(calls).toEqual(['compare','preview','checkpoint','approve']);expect(result).toMatchObject({status:'APPLIED',changes:1,borrowedMachines:['other']});
});
it('stores a resource requirement instead of inventing capacity or changing windows',async()=>{
 const invoke=vi.fn(async()=>({results:[],recommendation:{alternativeId:null}})),needs=vi.fn(async()=>[]);
 expect(await runAutomaticReplan({ids:['a']},'r',invoke,false,needs)).toMatchObject({status:'RESOURCE_REQUIRED'});
 expect(invoke).toHaveBeenCalledTimes(1);expect(needs).toHaveBeenCalledOnce();
});
it.each(['TIME_LIMIT','SIZE_LIMIT','INVALID'])('does not turn unfinished search into a resource request: %s',async failureKind=>{
 const invoke=vi.fn(async()=>({results:[{status:'BLOCKED',reason:'계산 미완료',result:{failureKind}}],recommendation:{alternativeId:null}})),needs=vi.fn(async()=>[]);
 await expect(runAutomaticReplan({ids:['a']},'r',invoke,false,needs)).rejects.toThrow('장비 부족으로 확정하지 않았습니다');
 expect(invoke).toHaveBeenCalledTimes(1);expect(needs).not.toHaveBeenCalled();
});
it.each(['INVALID','MISSING'])('never applies an unverified AI response: %s',async status=>{
 const invoke=vi.fn(async()=>({results:[{id:'a',status:'FEASIBLE'}],recommendation:{alternativeId:'a',rationaleCheck:{status}}}));
 await expect(runAutomaticReplan({ids:['a']},'r',invoke,true,async()=>[])).rejects.toThrow('검증');expect(invoke).toHaveBeenCalledOnce();
});
function manualFixture(){const {s,m}=replacementDurationFixture();s.fields[0].area=1000;m.workAreaM2=1000;m.manualAlternative={workers:2,minutesPer1000m2:240,setupMinutes:0,transport:0,simpleWorkConfirmed:true,reviewedBy:'격리 기준 담당',basis:'REVIEWED',sourceRef:'isolated-fixture'};return {s,m};}
it('uses an independent manual crew/time standard and preserves original records',()=>{
 const {s,m}=manualFixture(),before=structuredClone(s),next=withManualFallback(s,[m.id]);
 expect(manualWorkRequirement(s,m)).toMatchObject({workers:2,duration:16,personMinutes:480});
 expect(next.conversions).toEqual([m.id]);expect(next.state.missions.find(x=>x.id===m.id)).toMatchObject({resourceId:null,staff:2,ordinaryWorkers:2,machineOperators:0,duration:16,planningWindow:{duration:16}});expect(s).toEqual(before);
});
it('uses a split package area and refuses inconsistent area instead of inventing work rates',()=>{
 const {s,m}=manualFixture();m.workAreaM2=250;
 expect(manualWorkRequirement(s,m)).toMatchObject({duration:4,personMinutes:120});
 m.workAreaM2=1001;expect(manualWorkRequirement(s,m)).toBeNull();
});
it.each(['missing','started','farmer','spray','drone','demo-only','multi-day'])('does not manufacture safe manual capacity: %s',mode=>{
 const {s,m}=manualFixture();
 if(mode==='missing')delete m.manualAlternative;
 if(mode==='started')Object.assign(m,{executionStartedAt:'2032-09-01T09:00:00+09:00'});
 if(mode==='farmer')s.fields[0].mode='공동참여형';
 if(mode==='spray')Object.assign(m,{operationCode:'spray'});
 if(mode==='drone')m.resourceId='JB23DR01';
 if(mode==='demo-only')m.manualAlternative!.basis='DEMO_INPUT';
 if(mode==='multi-day')m.manualAlternative!.minutesPer1000m2=1000;
 expect(withManualFallback(s,[m.id]).conversions).toEqual([]);
});
it('considers another compatible local machine without a cross-center offer',()=>{
 const {s,m}=replacementDurationFixture();s.machines.push({...s.machines[1],id:'JB23TR02',ownerCenterId:'demo',type:'별도 표시 이름'});
 expect(resourceCandidates(s,m).map(r=>r.machine?.id)).toContain('JB23TR02');
 s.machines[2].compatibleCrops=['pepper'];expect(resourceCandidates(s,m).map(r=>r.machine?.id)).not.toContain('JB23TR02');
});
it('resolves saved legacy crop identity while still requiring explicit substitute compatibility',()=>{
 const {s,m}=replacementDurationFixture();delete m.compatibilityCrop;m.crop='쌀';
 const candidate={...s.machines[0],id:'JB23TR02',status:'AVAILABLE' as const,compatibleCrops:['rice' as const]};s.machines.push(candidate);
 expect(resourceCandidates(s,m).map(r=>r.machine?.id)).toContain(candidate.id);
 candidate.compatibleCrops=[];expect(resourceCandidates(s,m).map(r=>r.machine?.id)).not.toContain(candidate.id);
 candidate.compatibleCrops=['rice'];Object.assign(m,{crop:'미확인 작물'});expect(resourceCandidates(s,m).map(r=>r.machine?.id)).not.toContain(candidate.id);
});
it('keeps unmet prerequisite and equipment follow-up visible without suggesting manual conversion',()=>{
 const {s,m}=manualFixture();m.predecessorMissionIds=['completed'];s.missions[0].status='PLANNED';
 const before=structuredClone(s),needs=replanResolutionNeeds(s,{ids:[m.id]},weather,'2032-09-01');
 expect(needs[0].steps).toEqual(expect.arrayContaining(['PREREQUISITE','PROCUREMENT']));expect(needs[0].steps).not.toContain('MANUAL');expect(needs[0].note).not.toContain('인력 대체');expect(s).toEqual(before);
});
it('never searches manual replacement in the ordinary automatic flow',()=>{
 expect(automaticSearchSteps.map(s=>s.id)).toEqual(['preserve','expand','adjacent']);
 expect(automaticSearchSteps.some(s=>s.manualFallback)).toBe(false);
});

it('resource changes compare keep/local/adjacent options without stopping at the first feasible schedule',async()=>{
 const invoke=vi.fn(async(b:any)=>{
  if(b.action==='compare'){expect(b.searchMode).toBeUndefined();expect(b).toMatchObject({resourceReview:true,decisionPriority:'MIN_EXTERNAL',useAi:true});return {recommendation:{alternativeId:'preserve',source:'NEBIUS',rationaleCheck:{status:'VERIFIED'}},results:[{id:'preserve',status:'FEASIBLE',previewRequest:{action:'preview'},result:{}}]};}
  if(b.action==='preview')return {status:'FEASIBLE',proposalId:'same-plan',diff:[],assignments:[]};
  return {ok:true};
 });
 expect(await runAutomaticReplan({ids:['a'],resourceReview:true},'review',invoke,true,async()=>[])).toMatchObject({status:'APPLIED',source:'NEBIUS',changes:0});
 expect(invoke.mock.calls.map(c=>c[0].action)).toEqual(['compare','preview','approve']);
});
