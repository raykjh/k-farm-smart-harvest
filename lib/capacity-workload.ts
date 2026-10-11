import {capacityStudySchema,selectParticipatingOwners,studyCenterIds,contentHash,type CapacityStudyInput,type BaselineResources} from './capacity-study-input';
import {workloadCrop,workloadCrops,WORKLOAD_CATALOG_VERSION,type WorkloadMethod,type WorkloadOperation} from './crop-workload-catalog';
import {dateSlot,slotDate} from './scheduling-engine';
export const WORKLOAD_COMPILER_VERSION='workload-compiler-v2-occurrence-order';

export type WorkloadTask={
 id:string;pnu:string;ownerId:string;centerId:typeof studyCenterIds[number];cropId:string;
 operationCode:string;label:string;occurrence:number;part:number;from:string;to:string;
 durationSlots:number;workAreaM2:number;method:WorkloadMethod;predecessors:string[];
 conditional:boolean;weather:WorkloadOperation['weather'];basis:string;
};
const days=(a:string,b:string)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;
export function compileCapacityWorkload(raw:unknown,methodRates:Record<string,number>={}){
 const input=capacityStudySchema.parse(raw),participation=selectParticipatingOwners(input.population),tasks:WorkloadTask[]=[];
 const blockers:{pnu:string;code:string;message:string}[]=[];
 for(const p of participation.parcels){
  const profile=workloadCrop(p.cropId),before=tasks.length;
  if(p.suitability!=='SUITABLE'){blockers.push({pnu:p.pnu,code:'SUITABILITY_REVIEW',message:'해당 작물·지역 적합성 입력을 확인하세요.'});continue;}
  if(profile.lifecycle==='EXISTING_BEARING_ORCHARD'&&!p.existingBearingOrchard){blockers.push({pnu:p.pnu,code:'ORCHARD_STAGE',message:'기존 성목 과원만 계산합니다. 신규 식재에 당년 수확을 생성하지 않습니다.'});continue;}
  const byCode=new Map<string,WorkloadTask[]>();
  for(const operation of profile.operations){
   if(operation.kind==='CONDITIONAL'&&!input.includeConditionalReserve)continue;
   const original=operation.methods.find(m=>m.availability==='CURRENT');
   if(!original){blockers.push({pnu:p.pnu,code:'METHOD_MISSING',message:operation.name});continue;}
   const rate=methodRates[`${p.cropId}:${operation.code}`]??original.minutesPer1000m2;
   if(!Number.isFinite(rate)||rate<=0||original.setupMinutes<0||original.setupMinutes>=480)throw Error('작업 분할의 처리시간·준비시간을 확인하세요.');
   const method={...original,minutesPer1000m2:rate};
   const override=input.overrides.find(o=>o.cropId===p.cropId&&o.operationCode===operation.code);
   const windows=override?.windows??operation.windows.map(w=>({from:`${p.year+(w.yearOffset??0)}-${w.from}`,to:`${p.year+(w.yearOffset??0)}-${w.to}`}));
   const compiled:WorkloadTask[]=[];
   for(const [wi,window] of windows.entries()){
    if(days(window.from,window.to)<1||days(window.from,window.to)>730){blockers.push({pnu:p.pnu,code:'WINDOW_INVALID',message:operation.name});continue;}
    // Multi-day work is explicit: each day reserves setup, equipment and crew.
    let productive=p.areaM2/1000*method.minutesPer1000m2,part=0;
    while(productive>0){
     const consumed=Math.min(480-method.setupMinutes,productive),durationSlots=Math.ceil((consumed+method.setupMinutes)/15);
     const id=`${p.pnu}:${p.year}:${p.cropId}:${operation.code}:${wi+1}:${++part}`;
     const task:WorkloadTask={id,pnu:p.pnu,ownerId:p.ownerId,centerId:p.centerId,cropId:p.cropId,operationCode:operation.code,label:operation.name,occurrence:wi+1,part,from:window.from,to:window.to,durationSlots,workAreaM2:consumed/method.minutesPer1000m2*1000,method,predecessors:[],conditional:operation.kind==='CONDITIONAL',weather:operation.weather,basis:override?`${override.basis}: ${override.source}`:'DEMO_CALENDAR_AND_PRODUCTIVITY'};
     compiled.push(task);tasks.push(task);productive-=consumed;
     if(tasks.length>50000)throw Error('작업 수가 50,000건을 초과합니다. 입력 범위를 나누어 분석하세요. 일부 작업을 생략하지 않았습니다.');
    }
   }
   byCode.set(operation.code,compiled);
  }
  for(const operation of profile.operations){
   const compiled=byCode.get(operation.code)??[];
   for(const task of compiled){
    const previousPart=compiled.find(t=>t.occurrence===task.occurrence&&t.part===task.part-1);
    if(previousPart)task.predecessors.push(previousPart.id);
    if(task.part!==1)continue;
    if(task.occurrence>1){const previousRound=compiled.filter(t=>t.occurrence===task.occurrence-1).at(-1);if(previousRound)task.predecessors.push(previousRound.id);}
    for(const code of operation.predecessors){
     const parents=byCode.get(code)??[];
     // Harvest/packing pairs share occurrence; cleanup follows every harvest.
     const relevant=operation.code==='finish'?parents.filter(t=>t.occurrence===task.occurrence):parents;
     task.predecessors.push(...relevant.filter(t=>!relevant.some(x=>x.occurrence===t.occurrence&&x.part>t.part)).map(t=>t.id));
     if(!relevant.length)blockers.push({pnu:p.pnu,code:'PREDECESSOR_MISSING',message:`${operation.code}: ${code}`});
    }
   }
  }
  if(blockers.some(b=>b.pnu===p.pnu))tasks.splice(before);
 }
 if(tasks.length){const from=tasks.reduce((s,t)=>t.from<s?t.from:s,tasks[0].from),to=tasks.reduce((s,t)=>t.to>s?t.to:s,tasks[0].to);if(days(from,to)>1096)throw Error('한 자원계획은 최대 3년 범위로 나누어주세요. 연속 재배 기록은 삭제하지 않습니다.');}
 const inputHash=contentHash({version:WORKLOAD_CATALOG_VERSION,compiler:WORKLOAD_COMPILER_VERSION,input,...(Object.keys(methodRates).length?{methodRates}:{})});
 return {input,participation,tasks,blockers,inputHash,catalogVersion:WORKLOAD_CATALOG_VERSION,approvalEligible:false as const};
}
export type CapacityLoad={centerId:string;resource:string;totalHours:number;averageUnits:number;windowLowerBound:number;peakWindow:{from:string;to:string;hours:number}|null};
/** Necessary (not sufficient) density bound: work wholly inside every interval
 * must fit into that interval. It is not an optimal fleet or an actual roster. */
export function demandBounds(tasks:WorkloadTask[]):CapacityLoad[]{
 const grouped=new Map<string,{centerId:string;resource:string;maxCrew:number;windows:Map<string,{from:string;to:string;hours:number}>}>();
 for(const task of tasks){
  const hours=task.durationSlots/4,m=task.method;
  const resources:[string,number][]=[['operators',m.operators],['workers',m.workers],['transport',m.transport],...(m.capability?[[`equipment:${m.capability}`,1] as [string,number]]:[])];
  for(const [resource,units] of resources){if(!units)continue;const key=`${task.centerId}:${resource}`,group=grouped.get(key)??{centerId:task.centerId,resource,maxCrew:0,windows:new Map()};group.maxCrew=Math.max(group.maxCrew,units);
   const windowKey=task.from+'/'+task.to,window=group.windows.get(windowKey)??{from:task.from,to:task.to,hours:0};window.hours+=hours*units;group.windows.set(windowKey,window);grouped.set(key,group);
  }
 }
 return [...grouped.values()].map(g=>{
  const windows=[...g.windows.values()],starts=[...new Set(windows.map(w=>w.from))].sort(),ends=[...new Set(windows.map(w=>w.to))].sort();
  let bound=0,peak:CapacityLoad['peakWindow']=null;
  // Sweep start dates once; a prefix sum by end date replaces O(windows^3).
  const ordered=[...windows].sort((a,b)=>b.from.localeCompare(a.from)),endLoads=new Map<string,number>();let cursor=0;
  for(const from of [...starts].reverse()){
   while(cursor<ordered.length&&ordered[cursor].from>=from){const w=ordered[cursor++];endLoads.set(w.to,(endLoads.get(w.to)??0)+w.hours);}
   let hours=0;for(const to of ends){hours+=endLoads.get(to)??0;if(from>to)continue;const ratio=hours/(8*days(from,to));if(ratio>bound){bound=ratio;peak={from,to,hours};}}
  }
  const totalHours=windows.reduce((n,w)=>n+w.hours,0),span=days(starts[0],ends.at(-1)!);
  return {centerId:g.centerId,resource:g.resource,totalHours:Math.round(totalHours*100)/100,averageUnits:totalHours/(8*span),windowLowerBound:Math.max(g.maxCrew,Math.ceil(bound-1e-9)),peakWindow:peak};
 }).sort((a,b)=>a.centerId.localeCompare(b.centerId)||a.resource.localeCompare(b.resource));
}
export function proposeBaseline(inputHash:string,tasks:WorkloadTask[],bounds=demandBounds(tasks)):BaselineResources{
 const count=(centerId:string,resource:string)=>bounds.find(b=>b.centerId===centerId&&b.resource===resource)?.windowLowerBound??0;
 const centers=studyCenterIds.map(centerId=>({centerId,operators:count(centerId,'operators'),workers:count(centerId,'workers'),transport:count(centerId,'transport')}));
 const machines=bounds.filter(b=>b.resource.startsWith('equipment:')).flatMap(b=>{
  // Assumed crop-specific implements are part of this editable baseline input.
  // It is not a claim that a real registered machine supports all these crops.
  const capability=b.resource.slice(10),compatibleCrops=workloadCrops.filter(c=>c.operations.some(o=>o.methods.some(m=>m.capability===capability))).map(c=>c.id).sort();
  return Array.from({length:b.windowLowerBound},(_,i)=>({id:`${b.centerId}-${capability}-${String(i+1).padStart(3,'0')}`,ownerCenterId:b.centerId as typeof studyCenterIds[number],capability,compatibleCrops}));
 });
 return {version:'capacity-baseline-v1',catalogVersion:WORKLOAD_CATALOG_VERSION,inputHash,centers,machines};
}
export function summarizeCapacity(raw:unknown){
 const compiled=compileCapacityWorkload(raw),bounds=demandBounds(compiled.tasks),baseline=proposeBaseline(compiled.inputHash,compiled.tasks,bounds);
 const months=new Map<string,{month:string;centerId:string;possibleTasks:number;conditionalTasks:number}>();
 for(const task of compiled.tasks){const key=task.centerId+task.from.slice(0,7),m=months.get(key)??{month:task.from.slice(0,7),centerId:task.centerId,possibleTasks:0,conditionalTasks:0};m.possibleTasks++;if(task.conditional)m.conditionalTasks++;months.set(key,m);}
 return {...compiled,bounds,baseline,months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)||a.centerId.localeCompare(b.centerId)),
  resourceBasis:'WINDOW_DEMAND_LOWER_BOUND' as const,resourceWarning:'기간 수요의 하한값입니다. 휴무·기상·이동·선후행을 반영한 상세 배차 확인 전 확보량이나 최적 대수로 해석하지 않습니다.'};
}
export function workDates(from:string,to:string){const dates:string[]=[];for(let s=dateSlot(from);s<=dateSlot(to);s+=32)dates.push(slotDate(s));return dates;}
