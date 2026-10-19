import {newAttendance,type LaborOps,type LaborJob} from './labor-operations';
import {payBasis,payLabel,type LaborPolicy} from './labor-policy';

type Demand=Pick<LaborJob,'missionId'|'task'|'address'|'date'|'startMinute'|'durationMinutes'|'count'|'workCode'|'sourceHash'>&{held:boolean;completed?:boolean};
/** Commit-path only. No GET write, invented attendance, or paid model call. */
export function prepareRecruitment(s:LaborOps,demands:Demand[],policies:Record<string,{policy:LaborPolicy|null;version:number}>,now:string){
 let added=0;
 for(const d of demands){
  if(d.held||d.completed||d.count<1||Date.parse(d.date+'T00:00:00+09:00')+d.startMinute*60000<=Date.parse(now)||s.jobs.some(j=>j.missionId===d.missionId&&j.status!=='STALE'))continue;
  const p=policies[d.date.slice(0,4)],basis=payBasis(p?.policy??null,p?.version??0);
  s.jobs.push({...d,id:crypto.randomUUID(),pay:payLabel(basis),payBasis:basis,attendance:newAttendance(),status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[]});added++;
 }
 return added;
}
