import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {testPython as python} from './python-runtime';
import {compareReplanAlternatives,decisionSnapshot} from '../lib/planning-decision';
import {registeredDemo} from './registered-demo-fixture';
import type {State,Mission} from '../lib/types';
import type {ForecastResult} from '../lib/kma-forecast';
import type {EquipmentReplacement} from '../lib/equipment-replacement';
const weather={status:'NOT_CONFIGURED',kind:'short',points:[],sourceUrl:'test',fetchedAt:'2026-09-28'} as ForecastResult;
const asOf='2026-09-28';
// Only the HTTP transport is replaced: every response is computed by the real
// Python CP-SAT solver, then checked by calculateAnnualReplan/verifyAssignments.
beforeEach(()=>{vi.stubEnv('AI_MODE','nebius');vi.stubEnv('SOLVER_URL','http://127.0.0.1:18100');vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
 expect(url).toBe('http://127.0.0.1:18100/schedule');
 const out=execFileSync(python,'-c|import sys,json; from solver.replanning import Request,replan; print(json.dumps(replan(Request(**json.load(sys.stdin)))) )'.split('|'),{cwd:new URL('..',import.meta.url),input:init.body,encoding:'utf8',timeout:20000});
 return Response.json(JSON.parse(out));
}));});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
function state():State{
 const s=registeredDemo().state;s.machines=[s.machines.find(m=>m.id==='JB23DR01')!];s.staffCount=1;s.transportCount=1;
 const task=(id:string,index:number,date:string):Mission=>({id,fieldId:s.fields[index].id,label:'검증 작업',crop:'쌀',scheduledDate:date,month:9,owner:'장비',status:'PLANNED',resourceId:'JB23DR01',start:0,duration:32,deadline:32,priority:5,batchKey:id,staff:1,transport:1,
  ...{predecessorMissionIds:[],planningWindow:{from:'2026-09-29',to:'2026-10-02',duration:32,windLimitMs:5,rainSensitive:true,basis:'OPERATOR_PROVISIONAL_WINDOW'}}});
 s.missions=[task('selected',0,'2026-09-28'),task('other',1,'2026-09-29'),{...task('past',2,'2026-09-01'),status:'COMPLETED'}];return s;
}
it('compares preserving reservations with expanded rescheduling using the real engine; never saves or calls AI',async()=>{
 const s=state(),before=JSON.stringify(s);
 const result=await compareReplanAlternatives(s,{ids:['selected'],day:asOf,preferred:'2026-09-29'},[
  {id:'preserve',label:'기존 일정 유지',scope:'PRESERVE'},{id:'expand',label:'범위 확대',scope:'EXPAND'},
 ],weather,asOf);
 expect(result.results.map(r=>r.status),JSON.stringify(result.results)).toEqual(['FEASIBLE','FEASIBLE']);
 expect(result.results[0].metrics).toMatchObject({otherChangedTasks:0,preferredDistanceDays:1});
 expect(result.results[1].metrics).toMatchObject({otherChangedTasks:1,preferredDistanceDays:0});
 expect(result.nonDominatedIds).toEqual(['preserve','expand']);
 expect(result.results[0].previewRequest).toMatchObject({action:'preview',decisionSource:'DEVELOPMENT_REVIEW',comparisonSnapshot:decisionSnapshot(s,weather,asOf)});
 expect(JSON.stringify(s)).toBe(before);expect(result.reserved).toBe(false);expect(result.inferenceCalled).toBe(false);
 expect(result.results.every(r=>!r.result?.diff.some((d:any)=>d.id==='past'))).toBe(true);
});
it('registered replacement is unavailable before arrival and cannot bypass a missing confirmation',async()=>{
 const s=state();s.missions=s.missions.filter(m=>m.id!=='other');s.machines[0].status='MAINTENANCE';
 s.machines.push({...s.machines[0],id:'replacement',status:'AVAILABLE',availableFrom:'2026-10-01'});
 const replacement:EquipmentReplacement={failedId:'JB23DR01',replacementId:'replacement',availableFrom:'2026-10-01',availableUntil:'2026-10-02',arrivalConfirmed:true,compatibilityConfirmed:true,note:'Isolated fixture, not actual delivery'};
 const alternatives=[{id:'old',label:'기존 장비',replacement:'NONE'},{id:'new',label:'대체 장비',replacement:'REQUESTED'}];
 const result=await compareReplanAlternatives(s,{ids:['selected'],preferred:'2026-09-29',replacement},alternatives,weather,asOf);
 expect(result.results[0].status,JSON.stringify(result.results)).toBe('NO_FEASIBLE_PLAN');expect(result.results[1].status).toBe('FEASIBLE');
 expect(result.results[1].result!.diff[0]).toMatchObject({date:'2026-10-01',afterResource:'replacement'});
 const blocked=await compareReplanAlternatives(s,{ids:['selected'],replacement:{...replacement,arrivalConfirmed:false}},alternatives,weather,asOf);
 expect(blocked.results[1].status).toBe('BLOCKED');expect(blocked.results[1].previewRequest).toBeNull();
});
it('does not leak compare action metadata into the existing strict preview contract',async()=>{
 const result=await compareReplanAlternatives(state(),{ids:['selected'],action:'compare',alternatives:[]} as any,[{id:'one',label:'one'}],weather,asOf);
 expect(result.results[0].previewRequest).not.toHaveProperty('alternatives');expect(result.results[0].previewRequest?.action).toBe('preview');
});
it('refuses fabricated constraints, unconfirmed replacement requests, excess alternatives and duplicate IDs',async()=>{
 const s=state(),base={ids:['selected']};
 for(const options of [[{id:'x',label:'x',staff:999}],[{id:'x',label:'x'},{id:'x',label:'y'}],Array.from({length:7},(_,i)=>({id:String(i),label:'x'}))])await expect(compareReplanAlternatives(s,base,options,weather,asOf)).rejects.toThrow();
 const result=await compareReplanAlternatives(s,base,[{id:'x',label:'x',replacement:'REQUESTED'}],weather,asOf);
 expect(result.results[0].status).toBe('BLOCKED');expect(fetch).not.toHaveBeenCalled();
});
it('different state, arrival, loan and weather produce a different snapshot',()=>{
 const s=state(),id=decisionSnapshot(s,weather,asOf);
 s.machines[0].availableFrom='2026-10-01';expect(decisionSnapshot(s,weather,asOf)).not.toBe(id);
 expect(decisionSnapshot(state(),{...weather,status:'READY'},asOf)).not.toBe(id);
});
it.each(['TIME_LIMIT','SIZE_LIMIT','INVALID'])('keeps unfinished search out of infeasible evidence: %s',async failureKind=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:'NO_FEASIBLE_PLAN',failureKind,reason:'계산 미완료',contractVersion:'shared-schedule-v1',capacityPoolsVersion:'qualified-pools-v1',operatorVersion:'named-operators-v1',laborCapacityVersion:'confirmed-labor-v1',resourceDayVersion:'exclusive-center-days-v1'})));
 const result=await compareReplanAlternatives(state(),{ids:['selected']},[{id:'one',label:'one'}],weather,asOf);
 expect(result.results[0]).toMatchObject({status:'BLOCKED',metrics:null,previewRequest:null,result:{failureKind}});
 expect(result.nonDominatedIds).toEqual([]);
});
