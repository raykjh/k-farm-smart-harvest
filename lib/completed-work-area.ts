import type {AnnualPlan} from './annual-plan';
import type {Mission} from './types';
type Task=AnnualPlan['plots'][number]['tasks'][number];
const area=(t:Task)=>'workAreaM2' in t&&typeof t.workAreaM2==='number'?t.workAreaM2:null;
const group=(t:Task)=>`${t.operationCode}:${t.occurrence}`;

/** Keep the exact completed partition. Recompile only its remaining area using
 * the new plan's already resource-sized pieces. Never stretch a past result. */
export function preserveCompletedWorkAreas(plan:AnnualPlan,old:AnnualPlan,missions:Mission[]){
 const blockers:string[]=[];
 for(const plot of plan.plots){
  const prior=old.plots.find(p=>p.pnu===plot.pnu);if(!prior)continue;
  const completed=prior.tasks.filter(t=>missions.some(m=>m.id===t.id&&m.status==='COMPLETED'));
  if(Math.abs(plot.area-prior.area)>0.01&&completed.some(t=>area(t)===null)){
   blockers.push('완료 작업의 수행 면적이 연결되지 않은 과거 계획입니다. 실적 면적 확인 후 변경하세요.');continue;
  }
  const completeKeys=new Set(completed.map(t=>t.operationKey)),rewrites=new Map<string,string[]>(),created=new Set<string>();
  let tasks:Task[]=[...plot.tasks];
  for(const key of new Set(completed.filter(t=>area(t)!==null).map(group))){
   const done=completed.filter(t=>group(t)===key),next=tasks.filter(t=>group(t)===key);
   if(!next.length||done.some(t=>area(t)===null)||next.some(t=>area(t)===null)){blockers.push('완료 작업의 분할 면적 연결을 확인하세요.');continue;}
   const total=next.reduce((n,t)=>n+area(t)!,0),finished=done.reduce((n,t)=>n+area(t)!,0);
   if(finished>total+0.01){blockers.push('완료 작업 면적보다 작게 재배면적을 줄일 수 없습니다. 실적 정정 또는 별도 재배 검토가 필요합니다.');continue;}
   const template=next[0],chunk=Math.max(...next.map(t=>area(t)!));
   let remaining=Math.max(0,total-finished),part=Math.max(...prior.tasks.filter(t=>group(t)===key).map(t=>'part' in t&&typeof t.part==='number'?t.part:1));
   const base=template.operationKey.replace(/:part\d+/,''),own=new Set(next.map(t=>t.operationKey));
   const upstream=template.predecessorKeys.filter(k=>!own.has(k)),replacement:Task[]=done.map(t=>structuredClone(t));
   while(remaining>0.01){
    const workAreaM2=Math.min(chunk,remaining),id=`${base}:part${++part}`;
    const t={...structuredClone(template),id,operationKey:id,part,workAreaM2,name:template.name.replace(/\s*\(\d+일차\)$/,'')+` (잔여 ${part}일차)`,predecessorKeys:[...upstream,...(replacement.length?replacement.slice(-1).map(t=>t.operationKey):[])]};
    if(tasks.some(x=>x.operationKey===id&&!own.has(id)))throw Error('잔여 작업 식별자가 다른 작업과 충돌합니다.');
    replacement.push(t);created.add(id);remaining-=workAreaM2;
   }
   const terminals=replacement.length?[replacement.at(-1)!.operationKey]:[];
   for(const t of next)rewrites.set(t.operationKey,terminals);
   const at=tasks.findIndex(t=>group(t)===key);tasks=tasks.filter(t=>group(t)!==key);tasks.splice(at,0,...replacement);
  }
  for(const t of tasks){
   if(completeKeys.has(t.operationKey))continue;
   t.predecessorKeys=[...new Set(t.predecessorKeys.flatMap(k=>{
    const parent=tasks.find(p=>p.operationKey===k);
    return created.has(t.operationKey)&&parent&&group(parent)===group(t)?[k]:rewrites.get(k)??[k];
   }))];
  }
  plot.tasks=tasks as typeof plot.tasks;
 }
 plan.taskCount=plan.plots.reduce((n,p)=>n+p.tasks.length,0);
 return blockers;
}
