import {it,expect,vi,afterEach} from 'vitest';
import {compareCropAlternatives} from '../lib/crop-decision';
import {assessDevelopmentCropAlternatives} from '../lib/crop-planning-agent';
import {registeredDemo} from './registered-demo-fixture';
import type {AnnualPlan} from '../lib/annual-plan';
import type {State} from '../lib/types';
const paid=vi.hoisted(()=>vi.fn(()=>{throw Error('Paid inference forbidden')}));
vi.mock('../lib/ai-budget',()=>({APPROVED_MODEL:'not-used',budgetedCompletion:paid}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});

// Synthetic operating-profile fixtures, not agronomic recommendations.
function plan(machineCode:string|null,area=1000):AnnualPlan{return {year:2026,plots:[{pnu:'field',area,crop:'rice',mode:'full',tasks:[{
 id:'task',name:'fixture operation',kind:'PROCESS',operationKey:'operation',predecessorKeys:[],window:{from:'2026-10-01',to:'2026-10-02'},
 requirements:{machineCode,owner:machineCode?'장비':'센터 인력',staff:1,transport:machineCode?1:0,setupMinutes:0,laborMinutesPer1000m2:60},
}]}]} as unknown as AnnualPlan;}
function state():State{return {...registeredDemo().state,fields:[],missions:[],staffCount:2,transportCount:2,machines:[
 {id:'JB23TR01',ownerCenterId:'gyebuk',name:'local',type:'tractor',status:'AVAILABLE',safetyLock:false,capacityHaHour:0.1},
 {id:'JB24TR01',ownerCenterId:'gyenam',name:'neighbor',type:'tractor',status:'AVAILABLE',safetyLock:false,capacityHaHour:0.1},
],centerSharing:{centerId:'gyebuk',neighborCenterIds:['gyenam'],loans:[{id:'loan',machineId:'JB24TR01',ownerCenterId:'gyenam',borrowerCenterId:'gyebuk',usableFrom:'2026-10-02',usableUntil:'2026-10-02',status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true}]}};}
const options=[{id:'local',candidateId:'crop',resourceScope:'LOCAL_ONLY'},{id:'shared',candidateId:'crop',resourceScope:'CONFIRMED_SHARED'}];
it('compares local shortage with a confirmed neighboring resource after arrival; no paid call or mutation',async()=>{
 vi.stubEnv('AI_MODE','nebius');const s=state();s.machines[0].status='MAINTENANCE';const p=plan('TR'),before=JSON.stringify({s,p});
 const result=await assessDevelopmentCropAlternatives([{id:'crop',plan:p}],s,'2026-09-28',options);
 expect(result.results[0].status).toBe('INCOMPLETE');expect(result.results[1].status).toBe('CAPACITY_FEASIBLE');
 expect(result.results[1].metrics.workDays).toEqual(['2026-10-02']);expect(result.results[1].metrics.sharedMachineIds).toEqual(['JB24TR01']);
 expect(result.inferenceCalled).toBe(false);expect(result.reserved).toBe(false);expect(paid).not.toHaveBeenCalled();expect(JSON.stringify({s,p})).toBe(before);
});
it('does not count an unconfirmed loan, missing transport, late arrival or safety lock as capacity',async ()=>{
 for(const change of ['request','transport','late','lock']){const s=state();s.machines[0].status='MAINTENANCE';
  if(change==='request')s.centerSharing!.loans[0].status='REQUESTED';
  if(change==='transport')s.centerSharing!.loans[0].transportConfirmed=false;
  if(change==='late')s.centerSharing!.loans[0].usableFrom='2026-10-03';
  if(change==='lock')s.machines[1].safetyLock=true;
  expect((await compareCropAlternatives([{id:'crop',plan:plan('TR')}],s,'2026-09-28',options)).results.every(r=>r.status==='INCOMPLETE')).toBe(true);
 }
});
it('new equipment and field area change the calculated demand, not a scripted answer',async()=>{
 const s=state();s.machines=[];
 const compare=async (area:number)=>(await compareCropAlternatives([{id:'crop',plan:plan('TR',area)}],s,'2026-09-28',options)).results[0];
 expect((await compare(1000)).metrics.assignedTasks).toBe(0);s.machines=state().machines;
 expect((await compare(1000)).metrics.totalWorkMinutes).toBe(60);expect((await compare(2000)).metrics.totalWorkMinutes).toBe(120);
});
it('compares different operation profiles and keeps unavailable machinery distinct from human labor',async ()=>{
 const s=state();s.machines=[];
 const results=(await compareCropAlternatives([{id:'machine-crop',plan:plan('TR')},{id:'labor-crop',plan:plan(null)}],s,'2026-09-28',[
  {id:'a',candidateId:'machine-crop',resourceScope:'LOCAL_ONLY'},{id:'b',candidateId:'labor-crop',resourceScope:'LOCAL_ONLY'},
 ])).results;
 expect(results[0].status).toBe('INCOMPLETE');expect(results[1].metrics.staffPersonMinutes).toBe(60);
 s.staffCount=0;expect((await compareCropAlternatives([{id:'crop',plan:plan(null)}],s,'2026-09-28',options)).results[0].status).toBe('INCOMPLETE');
});
it('rejects unknown candidates, duplicate IDs, invalid dates and drafter-authored capacity',async()=>{
 const candidates=[{id:'crop',plan:plan('TR')}];
 for(const opts of [[{...options[0],candidateId:'invented'}],[options[0],options[0]],[{...options[0],staff:999}]])await expect(compareCropAlternatives(candidates,state(),'2026-09-28',opts)).rejects.toThrow();
 await expect(compareCropAlternatives(candidates,state(),'2026-02-30',options)).rejects.toThrow();
});
