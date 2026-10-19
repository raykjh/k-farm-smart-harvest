import {slotResourceConflict,type ResourceUse} from './scheduling-constraints';

/** Both initial admission and replanning use this solver contract and verifier. */
export const SCHEDULING_ENGINE_VERSION='shared-schedule-v1';
const epoch=Date.parse('2026-01-01T00:00:00Z');
export const dateSlot=(date:string)=>Math.round((Date.parse(date+'T00:00:00Z')-epoch)/86400000)*32;
export const slotDate=(slot:number)=>new Date(epoch+Math.floor(slot/32)*86400000).toISOString().slice(0,10);
export type ResourceOption={resource:string|null;allowed:number[];duration?:number;borrowed:boolean;offerId?:string;pools?:{day:number;id:string;capacity:number}[];operatorCandidates?:import('./named-operators').OperatorCandidate[];laborCandidates?:{id:string;personId:string;allowed:number[]}[]};
export type SchedulingJob=ResourceUse&{
 id:string;original:number;duration:number;allowed:number[];selected:boolean;preferred:number|null;
 predecessor:string|null;predecessors?:string[];movable?:boolean;locked?:boolean;options?:ResourceOption[];
 optional?:boolean;required?:boolean;operatorCount?:number;operatorIds?:string[];
 ordinaryWorkerCount?:number;laborSupportIds?:string[];workerPool?:string;
 /** A shared machine may serve only this center on its selected day. */
 resourceDayCenter?:string;
};
export type SchedulingContract={
 tasks:SchedulingJob[];freezeBefore:number;daily:boolean;staffCapacity:number;transportCapacity:number;
 purpose?:'INITIAL'|'REPLAN';rebuildMode?:'AUTO'|'PRESERVE'|'EXPAND';explicitPreferred?:boolean;
 capacityLimits?:Record<string,number>;
 capacityBlocks?:{start:number;duration:number;staff:number;capacityDemands:Record<string,number>}[];
};
export type SchedulingAssignment={id:string;start:number;resource?:string|null;duration?:number;operatorIds?:string[];laborSupportIds?:string[]};
export const assignedResource=(task:SchedulingJob,a:SchedulingAssignment)=>a.resource===undefined?task.resource:a.resource;
export const assignedOption=(task:SchedulingJob,a:SchedulingAssignment)=>task.options?.find(o=>o.resource===assignedResource(task,a)&&o.allowed.includes(a.start)&&(a.duration===undefined||a.duration===(o.duration??task.duration)));
export const assignedDuration=(task:SchedulingJob,a:SchedulingAssignment)=>assignedOption(task,a)?.duration??task.duration;

export function verifySchedule(c:SchedulingContract,assignments:SchedulingAssignment[],phase:string){
 const initial=c.purpose==='INITIAL';
 if(!(initial?phase==='INITIAL_DISPATCH':['GAPS_ONLY','REBUILD_RELATED','REBUILD_APPROVED'].includes(phase)))throw Error('계산 단계 불일치');
 if(!initial&&(c.rebuildMode==='PRESERVE'&&phase!=='GAPS_ONLY'||c.rebuildMode==='EXPAND'&&phase!=='REBUILD_APPROVED'))throw Error('승인 요청 범위와 계산 범위 불일치');
 const jobs=new Map(c.tasks.map(t=>[t.id,t])),entries=new Map(assignments.map(a=>[a.id,a]));
 if(jobs.size!==c.tasks.length||entries.size!==assignments.length||assignments.some(a=>!jobs.has(a.id))||c.tasks.some(t=>!entries.has(t.id)&&!(initial&&t.optional&&!t.locked)))throw Error('계산 작업 집합 불일치');
 const pools=new Map<string,{capacity:number;resources:Set<string>}>(),slots=new Map<number,ResourceUse[]>(),operators=new Map<number,Set<string>>();
 const exclusiveResources=new Set(c.tasks.filter(t=>t.resourceDayCenter).flatMap(t=>t.options?t.options.flatMap(o=>o.resource?[o.resource]:[]):t.resource?[t.resource]:[]));
 const resourceDays=new Map<string,string|null>();
 for(const a of assignments){
  const t=jobs.get(a.id)!,resource=assignedResource(t,a),duration=assignedDuration(t,a);
  const option=assignedOption(t,a),allowed=t.options?option?.allowed:resource===t.resource?t.allowed:undefined;
  if(resource&&exclusiveResources.has(resource)){
   const key=JSON.stringify([resource,Math.floor(a.start/32)]),center=t.resourceDayCenter??null;
   if(resourceDays.has(key)&&resourceDays.get(key)!==center)throw Error('차용 장비의 동일 일자 다중 센터 배치 금지');
   resourceDays.set(key,center);
  }
  if(!Number.isInteger(a.start)||!allowed?.includes(a.start)||!Number.isInteger(duration)||duration<1||duration>32||(a.start%32+32)%32+duration>32||a.duration!==undefined&&a.duration!==duration)throw Error('작업기간·기상·장비 사용 조건 위반');
  const frozen=t.locked||initial&&!t.optional||!initial&&!t.selected&&(phase==='GAPS_ONLY'||!(t.movable??t.original>=c.freezeBefore));
  if(frozen&&(a.start!==t.original||resource!==t.resource||duration!==t.duration))throw Error('단기·잠금·범위 밖 확정 일정 변경 금지');
  if(t.operatorCount!==undefined){
   const ids=a.operatorIds??[],candidates=option?.operatorCandidates??[];
   if(!Number.isInteger(t.operatorCount)||t.operatorCount<0||ids.length!==t.operatorCount||new Set(ids).size!==ids.length||ids.some(id=>!candidates.some(p=>p.id===id&&p.allowed.includes(a.start))))throw Error('운영자 자격·개인 근무시간·인원 위반');
   if(frozen&&t.operatorIds&&[...ids].sort().join('|')!==[...t.operatorIds].sort().join('|'))throw Error('확정된 운영자 배정 변경 금지');
   for(let s=a.start;s<a.start+duration;s++){const used=operators.get(s)??new Set<string>();for(const id of ids){if(used.has(id))throw Error('개인 운영자 중복 배정');used.add(id)}operators.set(s,used)}
  }else if(a.operatorIds?.length)throw Error('확인되지 않은 운영자 배정');
  for(const id of new Set([...(t.predecessors??[]),...(t.predecessor?[t.predecessor]:[])])){
   const previous=entries.get(id);
   if(jobs.has(id)&&(!previous||a.start<previous.start+assignedDuration(jobs.get(id)!,previous)))throw Error('작업 순서 위반');
  }
  for(const pool of option?.pools?.filter(p=>p.day===Math.floor(a.start/32))??[]){
   if(resource){const used=pools.get(pool.id)??{capacity:pool.capacity,resources:new Set<string>()};used.capacity=Math.min(used.capacity,pool.capacity);used.resources.add(resource);pools.set(pool.id,used);}
  }
  const supports=a.laborSupportIds??[],supportCandidates=option?.laborCandidates??[],count=t.ordinaryWorkerCount??0;
  if(supports.length>count||new Set(supports).size!==supports.length||supports.length>t.staff||supports.some(id=>!supportCandidates.some(p=>p.id===id&&p.allowed.includes(a.start))))throw Error('확정 인력 지원·작업 종류·이동시간 위반');
  if(frozen&&[...supports].sort().join('|')!==[...t.laborSupportIds??[]].sort().join('|'))throw Error('확정 인력 지원 배정 변경 금지');
  const use={...t,resource,staff:t.staff-supports.length,capacityDemands:{...t.capacityDemands}};
  if(t.workerPool){if((use.capacityDemands[t.workerPool]??0)<supports.length)throw Error('일반인력 수요 위반');use.capacityDemands[t.workerPool]-=supports.length;}
  for(let i=a.start;i<a.start+duration;i++){
   const people=operators.get(i)??new Set<string>();for(const id of supports){const person=supportCandidates.find(p=>p.id===id)!.personId;if(people.has(person))throw Error('지원 인력 중복 배정');people.add(person)}operators.set(i,people);
   const uses=slots.get(i)??[];uses.push(use);slots.set(i,uses);
  }
 }
 for(const b of c.capacityBlocks??[]){
  if(!Number.isInteger(b.start)||!Number.isInteger(b.duration)||b.duration<1||b.duration>32||!Number.isInteger(b.staff)||b.staff<0)throw Error('인력 지원 예약 시간 오류');
  for(let s=b.start;s<b.start+b.duration;s++){const uses=slots.get(s)??[];uses.push({field:null,resource:null,person:null,staff:b.staff,transport:0,capacityDemands:b.capacityDemands});slots.set(s,uses);}
 }
 for(const pool of pools.values())if(pool.resources.size>pool.capacity)throw Error('차용 센터 운영자·운송 여력 초과');
 for(const uses of slots.values()){
  if(slotResourceConflict(uses,{staff:c.staffCapacity,transport:c.transportCapacity}))throw Error('농지·장비·인력·운송 충돌');
  const keys=new Set(uses.flatMap(u=>Object.keys(u.capacityDemands??{})));
  for(const key of keys){const limit=c.capacityLimits?.[key],demand=uses.reduce((n,u)=>n+(u.capacityDemands?.[key]??0),0);
   if(limit===undefined||!Number.isInteger(limit)||limit<0||uses.some(u=>!Number.isInteger(u.capacityDemands?.[key]??0)||(u.capacityDemands?.[key]??0)<0)||demand>limit)throw Error('센터별 운영자·일반인력·운송 한도 초과');
  }
 }
}

export type ScheduleResult=
 |{status:'FEASIBLE';contractVersion:string;phase:string;assignments:SchedulingAssignment[];optimal:boolean;unassigned?:string[];components?:number;largestComponent?:number}
 |{status:'NO_FEASIBLE_PLAN';contractVersion:string;reason:string;failureKind?:'INFEASIBLE'|'TIME_LIMIT'|'SIZE_LIMIT'|'INVALID';components?:number;largestComponent?:number};
export async function solveSchedule(contract:SchedulingContract):Promise<ScheduleResult>{
 const response=await fetch((process.env.SOLVER_URL??'http://127.0.0.1:8100')+'/schedule',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(contract),signal:AbortSignal.timeout(contract.tasks.length>600?45000:14000),
 });
 if(!response.ok)throw Error('일정 계산 서비스 응답 오류');
 const result=await response.json();
 if(result.contractVersion!==SCHEDULING_ENGINE_VERSION)throw Error('공통 계산 계약을 적용하려면 계산 서버를 재시작하세요. 기존 계획은 변경하지 않았습니다.');
 if(contract.capacityLimits&&result.capacityPoolsVersion!=='qualified-pools-v1')throw Error('센터별 자원 풀을 지원하는 계산 서버로 재시작해야 합니다. 계산·예약을 적용하지 않았습니다.');
 if(contract.tasks.some(t=>t.operatorCount!==undefined)&&result.operatorVersion!=='named-operators-v1')throw Error('개인 운영자 배정을 지원하는 계산 서버로 재시작해야 합니다.');
 if(contract.tasks.length>600&&result.largeScheduleVersion!=='resource-time-components-v2')throw Error('자원·기간별 대규모 일정 분해를 지원하는 계산 서버로 재시작해야 합니다.');
 if(contract.tasks.some(t=>t.resourceDayCenter)&&result.resourceDayVersion!=='exclusive-center-days-v1')throw Error('센터 간 장비의 일일 단독 사용을 지원하는 계산 서버로 재시작해야 합니다.');
 if((contract.capacityBlocks?.length||contract.tasks.some(t=>t.ordinaryWorkerCount!==undefined))&&result.laborCapacityVersion!=='confirmed-labor-v1')throw Error('확정 인력 지원을 처리하는 계산 서버로 재시작해야 합니다.');
 if(result.status==='NO_FEASIBLE_PLAN')return result;
 if(result.status!=='FEASIBLE'||!Array.isArray(result.assignments)||typeof result.optimal!=='boolean')throw Error('계산 결과 형식 오류');
 verifySchedule(contract,result.assignments,result.phase);
 return result;
}
