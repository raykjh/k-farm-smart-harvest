import assert from 'node:assert/strict';
import {registeredDemo} from '../../tests/registered-demo-fixture';
import {compareReplanAlternatives} from '../../lib/planning-decision';
import {compareCropAlternatives} from '../../lib/crop-decision';
import {coordinateCandidate,type CoordinationContext} from '../../lib/production-coordination';
import type {OperatingCropFacts} from '../../lib/operating-crop-adviser';
import type {State,Mission} from '../../lib/types';
import type {ForecastResult} from '../../lib/kma-forecast';
import type {ReplanInput} from '../../lib/annual-replanning';
import type {AnnualPlan} from '../../lib/annual-plan';

// Synthetic, in-memory case inputs, NOT agronomic recommendations or real loans.
// Production solver, replan validator and crop feasibility adapters are unchanged.
export const caseDate='2032-08-31';
const weather={status:'NOT_CONFIGURED',kind:'short',points:[],sourceUrl:'fixture://missing-forecast',fetchedAt:caseDate} as ForecastResult;
type TestMission=Mission&{operationCode:string;predecessorMissionIds:string[];planningWindow:{from:string;to:string;duration:number;windLimitMs:number;rainSensitive:boolean;basis:string}};
function task(id:string,field:number,date:string,patch:Partial<TestMission>={}):TestMission{
 return {id,fieldId:`field-${field}`,label:'격리 비교 작업',crop:'쌀',scheduledDate:date,month:9,owner:'장비',status:'PLANNED',resourceId:'JB23DR01',start:0,duration:32,deadline:32,priority:5,batchKey:id,staff:1,transport:1,
  operationCode:'spray',predecessorMissionIds:[],planningWindow:{from:'2032-09-01',to:'2032-09-09',duration:32,windLimitMs:5,rainSensitive:true,basis:'OPERATOR_PROVISIONAL_WINDOW'},...patch};
}
function base():State{
 const s=registeredDemo().state;
 s.fields=s.fields.slice(0,6).map((f,i)=>({...f,id:`field-${i}`,farmerId:`synthetic-${i}`,name:'가상 참여자',address:'격리된 가상 필지'}));
 s.machines=s.machines.filter(m=>m.id==='JB23DR01'||m.id==='JB23SP01');s.staffCount=1;s.transportCount=1;s.events=[];s.revisions=[];
 s.missions=[task('selected',0,'2032-09-01'),task('other',1,'2032-09-01'),task('completed',2,'2032-08-20',{status:'COMPLETED'})];
 return s;
}
const options=[{id:'preserve',label:'기존 일정 유지',scope:'PRESERVE'},{id:'expand',label:'충돌 관련 일정 조정',scope:'EXPAND'}];
export async function scheduleCases(){
 const output:{id:string;reason:string;comparison:Awaited<ReturnType<typeof compareReplanAlternatives>>;checks:Record<string,boolean>}[]=[];
 const check=async(id:string,s:State,input:ReplanInput,reason:string,alternatives:unknown=options,verify?:(r:Awaited<ReturnType<typeof compareReplanAlternatives>>)=>void)=>{
  const before=JSON.stringify(s),comparison=await compareReplanAlternatives(s,input,alternatives,weather,caseDate);
  assert.equal(JSON.stringify(s),before,'Fixture state must be preserved');
  assert(comparison.results.some(r=>r.status==='FEASIBLE'),`${id}: no feasible case: ${JSON.stringify(comparison.results.map(r=>({id:r.id,status:r.status,reason:r.reason})))}`);
  assert(comparison.results.every(r=>!r.result?.diff.some(d=>d.id==='completed')),'Completed history is protected');
  assert.equal(comparison.reserved,false);assert.equal(comparison.approval,'REQUIRED');verify?.(comparison);
  output.push({id,reason,comparison,checks:{inputUnchanged:true,completedPreserved:true,noReservation:true,approvalRequired:true,productionSolver:true}});
 };
 await check('preferred-date-tradeoff',base(),{ids:['selected'],preferred:'2032-09-01'},'희망일보다 기존 확정 일정의 변경을 최소화하는 것을 우선 검토합니다.',options,r=>{
  assert.equal(r.results[0].metrics?.otherChangedTasks,0);assert.equal(r.results[1].metrics?.preferredDistanceDays,0);
 });
 const broken=base();broken.missions=broken.missions.filter(m=>m.id!=='other');broken.machines[0].status='MAINTENANCE';
 broken.machines.push({...broken.machines[0],id:'confirmed-replacement',status:'AVAILABLE',availableFrom:'2032-09-03'});
 await check('equipment-arrival-gap',broken,{ids:['selected'],preferred:'2032-09-01',replacement:{failedId:'JB23DR01',replacementId:'confirmed-replacement',availableFrom:'2032-09-03',availableUntil:'2032-09-09',arrivalConfirmed:true,compatibilityConfirmed:true,note:'격리 사례에서만 확인된 도착·호환 조건'}},'고장 장비는 사용하지 않고 확인된 대체 장비가 도착한 이후로만 배치합니다.',[
  {id:'broken-only',label:'고장 장비 유지',replacement:'NONE',scope:'PRESERVE'},{id:'replacement',label:'확인된 대체 장비',replacement:'REQUESTED',scope:'PRESERVE'},
 ],r=>{assert.notEqual(r.results[0].status,'FEASIBLE');assert(r.results[1].result!.diff.every(d=>d.date>='2032-09-03'));});
 const wind=base();wind.staffCount=2;wind.transportCount=2;wind.missions=wind.missions.filter(m=>m.id!=='other');
 wind.missions.push(task('ground-protected',3,'2032-09-01',{resourceId:'JB23SP01',planningWindow:{from:'2032-09-01',to:'2032-09-09',duration:32,windLimitMs:12,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'}}));
 const windInput:ReplanInput={ids:['selected'],preferred:'2032-09-01',simulation:{kind:'WIND',from:'2032-09-01',to:'2032-09-02'}};
 await check('wind-drone-vs-ground',wind,windInput,'드론은 강풍 기간을 피하고 조건을 충족한 지상 작업은 기존 일정대로 유지합니다.',options,r=>{
  for(const c of r.results.filter(c=>c.status==='FEASIBLE')){assert(c.result!.diff.filter(d=>d.id==='selected').every(d=>d.date>'2032-09-02'));assert(!c.result!.diff.some(d=>d.id==='ground-protected'));}
 });
 const absent=base();absent.missions=absent.missions.filter(m=>m.id==='completed');absent.crewCapacity={operators:0,workers:1};
 absent.laborCapacity={incoming:[],outgoing:[],absences:[{workerId:'synthetic-absentee',date:'2032-09-01',startMinute:480,endMinute:960}]};
 absent.missions.push(task('selected',0,'2032-09-01',{owner:'센터 인력',resourceId:null,transport:0,ordinaryWorkers:1,machineOperators:0,operationCode:'harvest'}));
 await check('labor-absence',absent,{ids:['selected'],preferred:'2032-09-01'},'참석 가능한 인력이 없는 날은 피하고 작업기간 안에서 재배치합니다.',options,r=>{
  assert(r.results.filter(c=>c.status==='FEASIBLE').every(c=>c.result!.diff.filter(d=>d.id==='selected').every(d=>d.date>'2032-09-01')));
 });
 const compound=base();compound.staffCount=2;compound.crewCapacity={operators:1,workers:1};compound.missions=compound.missions.filter(m=>m.id==='completed');
 compound.machines[0].status='MAINTENANCE';compound.machines.push({...compound.machines[0],id:'confirmed-replacement',status:'AVAILABLE',availableFrom:'2032-09-03'});
 compound.laborCapacity={incoming:[],outgoing:[],absences:[{workerId:'synthetic-absentee',date:'2032-09-03',startMinute:480,endMinute:960}]};
 compound.missions.push(task('selected',0,'2032-09-01',{machineOperators:1,ordinaryWorkers:0}),task('harvest',1,'2032-09-01',{owner:'센터 인력',resourceId:null,staff:1,transport:0,machineOperators:0,ordinaryWorkers:1,operationCode:'harvest'}));
 await check('compound-fault-wind-absence',compound,{ids:['selected','harvest'],day:'2032-09-01',preferred:'2032-09-03',simulation:{kind:'WIND',from:'2032-09-01',to:'2032-09-02'},replacement:{failedId:'JB23DR01',replacementId:'confirmed-replacement',availableFrom:'2032-09-03',availableUntil:'2032-09-09',arrivalConfirmed:true,compatibilityConfirmed:true,note:'격리 복합 사고의 확인된 대체 장비'}},'고장·강풍·인력 불참을 동시에 지키고, 가능한 작업은 먼저 배치합니다.',options,r=>{
  for(const c of r.results.filter(c=>c.status==='FEASIBLE')){assert(c.result!.diff.find(d=>d.id==='selected')!.date>='2032-09-03');assert.notEqual(c.result!.diff.find(d=>d.id==='harvest')?.date,'2032-09-03');}
 });
 return output;
}

export async function cropCase(){
 const s=base();s.missions=[];s.staffCount=2;s.transportCount=2;
 const crops=['rice','potato','pepper'] as const;
 const candidates=crops.map((crop,i)=>({id:crop,plan:{year:2032,plots:[{pnu:'synthetic-parcel',area:1000,crop,mode:'full',consultationId:'synthetic-owner',address:'격리 가상 농지',tasks:[{id:`${crop}-harvest`,name:'수확',operationCode:'harvest',operationKey:`${crop}:harvest`,predecessorKeys:[],kind:'PROCESS',window:{from:'2032-09-01',to:'2032-09-09'},requirements:{owner:'센터 인력',staff:1,transport:0,machineCode:null,laborMinutesPer1000m2:60+i*30,setupMinutes:0,requiresOperator:false,rainSensitive:false}}]}]} as unknown as AnnualPlan}));
 const compared=await compareCropAlternatives(candidates,s,caseDate,crops.map(id=>({id,candidateId:id,resourceScope:'LOCAL_ONLY'})));
 assert(compared.results.every(r=>r.status==='CAPACITY_FEASIBLE'));
 // All yield/target/specialty values below are explicit fixture assumptions. They
 // exercise the existing capped signal formula; they are not official statistics.
 const evidence={sourceUrl:'https://example.invalid/isolated-fixture',method:'synthetic comparison only',checkedOn:caseDate,validUntil:'2032-12-31'};
 const context:CoordinationContext={centerId:'demo',today:caseDate,origin:'DEMO',contributions:[{id:'prior-rice',centerId:'demo',crop:'rice',areaM2:1000,year:2032,commodity:'fixture-rice',kg:{low:1900,high:2100},origin:'DEMO',basis:'SYNTHETIC'}],policy:{yields:[],targets:[{commodity:'fixture-rice',year:2032,kg:1000,origin:'DEMO',...evidence}],specialties:[{centerId:'demo',crop:'potato',status:'ESTABLISHED',bonus:3,...evidence}]}};
 const facts:OperatingCropFacts[]=crops.map((crop,i)=>{
  const result=compared.results.find(r=>r.id===crop)!;
  const coordinated=coordinateCandidate({id:crop,centerId:'demo',crop,areaM2:1000,year:2032,commodity:`fixture-${crop}`,kg:{low:400,high:500},origin:'DEMO',basis:'SYNTHETIC'},[92,88,87][i],context);
  return {id:crop,crop,score:coordinated.score,specialtyBonus:coordinated.specialtyBonus,supplyPenalty:coordinated.supply.penalty,borrowedEquipmentTasks:result.dispatch.assignments.filter(a=>result.metrics.sharedMachineIds.includes(a.machineId??'')).length,personMinutes:result.metrics.staffPersonMinutes};
 });
 return {id:'crop-concentration-specialty',facts,checks:{productionSolver:true,allCandidatesCapacityFeasible:true,noReservation:true,approvalRequired:true,coverage:'PARTICIPATING_CULTIVATIONS_ONLY',policyInputs:'SYNTHETIC_NOT_OFFICIAL',scope:'adapter comparison; automatic crop intake remains rules-only'}};
}
