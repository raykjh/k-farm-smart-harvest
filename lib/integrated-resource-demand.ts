import type {ProductionCandidate} from './continuous-production';
import type {ProductionSource} from './production-service';
type WindowDemand={from:string;to:string;hours:number|null};
/** A necessary lower bound, never proof that equipment/operator/transport
 * schedules fit. The common solver alone determines executable feasibility. */
export function equipmentWindowBound(rows:WindowDemand[]){
 if(rows.some(r=>r.hours===null))return null;
 let bound=rows.length?1:0;
 const starts=[...new Set(rows.map(r=>r.from))],ends=[...new Set(rows.map(r=>r.to))];
 for(const from of starts)for(const to of ends){
  const days=(Date.parse(to)-Date.parse(from))/86400000+1;if(days<1||days>731)continue;
  const hours=rows.filter(r=>r.from>=from&&r.to<=to).reduce((n,r)=>n+r.hours!,0);
  bound=Math.max(bound,Math.ceil(hours/(days*8)-1e-9));
 }
 return bound;
}
export function equipmentAcquisitionPlan(sources:ProductionSource[],candidates:{centerId:string;candidate:ProductionCandidate}[]){
 const groups=new Map<string,{centerId:string;code:string;rows:WindowDemand[]}>();
 for(const {centerId,candidate} of candidates)for(const plot of candidate.plan.plan.plots)for(const task of plot.tasks){
  if(!['PROCESS','REPEAT'].includes(task.kind)||!task.requirements.machineCode)continue;
  const code=task.requirements.machineCode,key=centerId+':'+code,group=groups.get(key)??{centerId,code,rows:[]};
  const speeds=sources.flatMap(s=>s.state?.machines??[]).filter(m=>m.id.includes(code)&&m.capacityHaHour>0&&(!('compatibilityCrop' in task)||!task.compatibilityCrop||m.compatibleCrops?.includes(task.compatibilityCrop))).map(m=>m.capacityHaHour);
  const hours=speeds.length?Math.ceil(((task.workAreaM2/10000/Math.max(...speeds)*60)+task.requirements.setupMinutes)/15)/4:null;
  group.rows.push({from:task.window?.from??candidate.plan.cultivation.start,to:task.window?.to??candidate.plan.cultivation.end,hours:task.window?hours:null});groups.set(key,group);
 }
 return [...groups.values()].map(group=>{
  const source=sources.find(s=>s.scopeId===group.centerId)!;
  for(const m of source.state?.missions??[])if(m.scheduledDate&&m.scheduledDate>=source.today&&!['COMPLETED','CANCELLED'].includes(m.status)&&m.resourceId?.includes(group.code)&&!m.resourceOccupancyOnly)group.rows.push({from:m.scheduledDate,to:m.scheduledDate,hours:m.duration/4});
  const minimumUnits=equipmentWindowBound(group.rows),ownedUnits=source.state?.machines.filter(m=>m.id.includes(group.code)&&(!m.ownerCenterId||m.ownerCenterId===source.scopeId)).length??0;
  return {centerId:group.centerId,code:group.code,from:group.rows.map(r=>r.from).sort()[0],to:group.rows.map(r=>r.to).sort().at(-1)!,workHours:group.rows.every(r=>r.hours!==null)?group.rows.reduce((n,r)=>n+r.hours!,0):null,minimumUnits,ownedUnits,additionalLowerBound:minimumUnits===null?null:Math.max(0,minimumUnits-ownedUnits),basis:'NECESSARY_WINDOW_LOWER_BOUND' as const,acquired:false as const};
 });
}
