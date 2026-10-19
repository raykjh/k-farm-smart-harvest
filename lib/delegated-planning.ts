import {z} from 'zod';
import {planningContext} from './planning-context';
import {cultivationSchema,checkCultivation,previousCultivationTerminals,type Cultivation} from './cultivation';
import {buildAnnualPlan,type AnnualPlan} from './annual-plan';
import {previewAnnualDispatch} from './annual-dispatch';
import {compareCropAlternatives} from './crop-decision';
import {recommendConditions} from './field-conditions';
import type {FieldEntry} from './field-record';
import type {State} from './types';
import type {SupportedCropCode} from './crop-registry';
import {appendAssignments} from './plan-missions';
export {appendAssignments} from './plan-missions';
export const delegatedSettings=z.object({start:z.string(),end:z.string(),context:planningContext}).strict();
export type DelegatedSettings={start:string;end:string;context:z.infer<typeof planningContext>};
export function validateSettings(raw:unknown):DelegatedSettings{
 const v=delegatedSettings.parse(raw);
 cultivationSchema.parse({id:'10000000-0000-4000-8000-000000000001',pnu:'5274036023110930000',crop:'rice',start:v.start,end:v.end,source:'REGISTERED'});
 if(Date.parse(v.end)-Date.parse(v.start)>730*86400000)throw Error('계획 기간은 2년 이내로 설정하세요.');
 if(!v.context.region?.trim())throw Error('공통 기준의 지역을 입력하세요.');
 return v;
}
export type Dispatch=Awaited<ReturnType<typeof previewAnnualDispatch>>;
export async function delegatedProposal(fields:FieldEntry[],version:number,state:State,existing:Cultivation[],settings:DelegatedSettings,idFor:(pnu:string)=>string,today:string,names:Record<string,string>={},options:{crops?:SupportedCropCode[];preserveOrder?:boolean;includeUnassigned?:boolean}={}){
 existing=existing.filter(c=>!c.closedAt);
 let reserved=structuredClone(state);
 const plans:{cultivation:Cultivation;plan:AnnualPlan;dispatch:Dispatch;score:number}[]=[],pending:{pnu:string;address:string;reason:string}[]=[];
 const comparisons:{pnu:string;address:string;crop:string;score:number;status:'CAPACITY_FEASIBLE'|'INCOMPLETE'|'BLOCKED';assigned:number;reasons:string[];selected:boolean;resourceAlternatives?:{scope:string;status:string;metrics:Awaited<ReturnType<typeof compareCropAlternatives>>['results'][number]['metrics']}[]}[]=[];
 for(const f of [...fields].filter(f=>f.mode==='full').sort((a,b)=>options.preserveOrder?0:a.pnu.localeCompare(b.pnu))){
  const wait=(reason:string)=>pending.push({pnu:f.pnu,address:f.address,reason});
  if(!f.area||!f.consultationId){wait('면적·농부 상담 연결 확인 필요');continue;}
  if(f.conditions?.region!==settings.context.region){wait('농지와 공통 기준 지역 확인 필요');continue;}
  if(existing.some(c=>c.pnu===f.pnu&&c.start<=settings.end&&settings.start<=c.end)){wait('해당 기간의 재배 건이 이미 있습니다. 기존 재계획을 이용하세요.');continue;}
  const previous=existing.filter(c=>c.pnu===f.pnu&&c.end<settings.start).sort((a,b)=>a.end.localeCompare(b.end)).at(-1);
  const candidates=recommendConditions(f.conditions).filter(c=>(!options.crops||options.crops.includes(c.crop))&&c.score!==null&&!c.blocked.length&&!c.missing.length);
  if(!candidates.length){wait('작물 적합성·현장 확인 근거 부족 또는 부적합');continue;}
  const reasons:string[]=[];const evaluated:typeof plans=[];
  for(const c of candidates){try{
   const cultivation:Cultivation={id:idFor(f.pnu),pnu:f.pnu,crop:c.crop,start:settings.start,end:settings.end,source:'REGISTERED',...(previous?{previousId:previous.id}:{})};checkCultivation(cultivation,existing);
   const plan=buildAnnualPlan([{...f,crop:c.crop}],Number(settings.start.slice(0,4)),version,settings.context,cultivation,undefined,reserved);
   if(previous){const terminals=previousCultivationTerminals(previous,reserved.missions);for(const task of plan.plots[0].tasks)if(!task.predecessorKeys.length)task.predecessorKeys.push(...terminals);}
   if(f.conditions?.machineAccess!=='yes'&&plan.plots[0].tasks.some(t=>t.requirements.machineCode))throw Error('장비 진입 불가, 대체 인력 작업 기준 필요');
   const resourceComparison=(await compareCropAlternatives([{id:c.crop,plan}],reserved,today,[
    {id:'local',candidateId:c.crop,resourceScope:'LOCAL_ONLY'},
    {id:'shared',candidateId:c.crop,resourceScope:'CONFIRMED_SHARED'},
   ]));
   // Borrow only when local capacity is insufficient, not because a neighbor's
   // machine happened to be listed first in the inventory.
   const dispatch=(resourceComparison.results[0].status==='CAPACITY_FEASIBLE'?resourceComparison.results[0]:resourceComparison.results[1]).dispatch;
   const missing=[...new Set(dispatch.pending.map(p=>p.reason))];
   comparisons.push({pnu:f.pnu,address:f.address,crop:c.crop,score:c.score!,status:dispatch.feasibility.length>0&&dispatch.feasibility.every(x=>x.status==='CAPACITY_FEASIBLE')?'CAPACITY_FEASIBLE':'INCOMPLETE',assigned:dispatch.assignments.length,reasons:missing,selected:false,resourceAlternatives:resourceComparison.results.map(r=>({scope:r.resourceScope,status:r.status,metrics:r.metrics}))});
   reasons.push(c.crop+': '+missing.join(', '));
   if(dispatch.assignments.length||options.includeUnassigned)evaluated.push({cultivation,plan,dispatch,score:c.score!});
  }catch(e){const reason=e instanceof Error?e.message:'기준 확인 필요';reasons.push(c.crop+': '+reason);comparisons.push({pnu:f.pnu,address:f.address,crop:c.crop,score:c.score!,status:'BLOCKED',assigned:0,reasons:[reason],selected:false});}}
  // Evaluate alternatives against the same prior reservations, then reserve only the winner.
  evaluated.sort((a,b)=>Number(b.dispatch.feasibility.every(x=>x.status==='CAPACITY_FEASIBLE'))-Number(a.dispatch.feasibility.every(x=>x.status==='CAPACITY_FEASIBLE'))||b.score-a.score);
  const winner=evaluated[0];
  if(winner){plans.push(winner);reserved=appendAssignments(reserved,winner.plan,winner.dispatch,names);const row=comparisons.find(c=>c.pnu===f.pnu&&c.crop===winner.cultivation.crop);if(row)row.selected=true;}
  else wait(reasons.join(' / '));
 }
 const assignments=plans.flatMap(p=>p.dispatch.assignments);
 const demand=[...new Set(assignments.map(a=>a.date))].sort().map(date=>{
  const rows=assignments.filter(a=>a.date===date),slots=Array.from({length:32},(_,i)=>rows.filter(a=>a.startMinute<=480+i*15&&480+i*15<a.startMinute+a.durationMinutes));
  return {date,tasks:rows.length,machines:[...new Set(rows.map(a=>a.machineId).filter(Boolean))],staffPeak:Math.max(0,...slots.map(rs=>rs.reduce((n,a)=>n+a.staff,0))),transportPeak:Math.max(0,...slots.map(rs=>rs.reduce((n,a)=>n+a.transport,0))),personMinutes:rows.reduce((n,a)=>n+a.staff*a.durationMinutes,0)};
 });
 return {plans,pending,comparisons,demand,assigned:assignments.length,unassigned:plans.reduce((n,p)=>n+p.dispatch.pending.length,0),approvalBlocked:plans.some(p=>p.dispatch.feasibility.some(f=>f.status!=='CAPACITY_FEASIBLE')),state:reserved};
}
