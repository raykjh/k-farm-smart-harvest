import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {AnnualPlan} from './annual-plan';
import type {State} from './types';
import {compareCropFeasibility} from './crop-feasibility';
import {SCHEDULING_ENGINE_VERSION} from './scheduling-engine';

export const cropAlternativesSchema=z.array(z.object({
 id:z.string().trim().min(1).max(80),candidateId:z.string().trim().min(1).max(200),
 resourceScope:z.enum(['LOCAL_ONLY','CONFIRMED_SHARED']),
}).strict()).min(1).max(12).refine(v=>new Set(v.map(x=>x.id)).size===v.length,'대안 ID 중복');

/** Server-built candidate plans only. The drafter selects IDs and resource scope,
 * never supplies crop windows, free equipment, staffing counts or ownership facts. */
export async function compareCropAlternatives(candidates:{id:string;plan:AnnualPlan}[],state:State,asOf:string,alternatives:unknown){
 const options=cropAlternativesSchema.parse(alternatives);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString().slice(0,10)!==asOf)throw Error('계획 날짜 확인 필요');
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length)throw Error('후보 ID 중복');
 if(options.some(o=>!candidates.some(c=>c.id===o.candidateId)))throw Error('서버가 제공한 작물 후보만 비교할 수 있습니다.');
 const source=structuredClone(state),center=source.centerSharing?.centerId??'demo';
 const results=[];
 for(const option of options){
  const candidate=candidates.find(c=>c.id===option.candidateId)!;
  const scoped={...source,laborCapacity:source.laborCapacity?{...source.laborCapacity,allowNewSupport:option.resourceScope==='CONFIRMED_SHARED'}:undefined,machines:source.machines.filter(m=>option.resourceScope==='CONFIRMED_SHARED'||m.ownerCenterId===center||!source.centerSharing&&!m.ownerCenterId)};
  const assessment=(await compareCropFeasibility([candidate],scoped,asOf))[0];
  const assignments=assessment.dispatch.assignments;
  const machineIds=[...new Set(assignments.map(a=>a.machineId).filter((id):id is string=>typeof id==='string'))];
  results.push({...option,...assessment,candidateId:option.candidateId,
   metrics:{assignedTasks:assessment.assigned,missingRequiredTasks:assessment.fields.reduce((n,f)=>n+f.missing.length,0),
    totalWorkMinutes:assignments.reduce((n,a)=>n+a.durationMinutes,0),
    staffPersonMinutes:assignments.reduce((n,a)=>n+a.staff*a.durationMinutes,0),
    sharedWorkerMinutes:assignments.reduce((n,a)=>n+(a.laborSupportIds?.length??0)*a.durationMinutes,0),
    supportWindowIds:[...new Set(assignments.flatMap(a=>a.laborSupportIds??[]))],
    farmerWorkMinutes:assignments.filter(a=>a.owner==='농부').reduce((n,a)=>n+a.durationMinutes,0),
    machineIds,sharedMachineIds:machineIds.filter(id=>{const m=source.machines.find(m=>m.id===id)!;return !!m.ownerCenterId&&m.ownerCenterId!==center;}),
    workDays:[...new Set(assignments.map(a=>a.date))].sort()},
  });
 }
 return {source:'DEVELOPMENT_REVIEW' as const,inferenceCalled:false,reserved:false,approval:'REQUIRED' as const,
  snapshot:{planVersion:source.planVersion,asOf,engineVersion:SCHEDULING_ENGINE_VERSION,id:createHash('sha256').update(JSON.stringify({engine:SCHEDULING_ENGINE_VERSION,candidates,state:source,asOf})).digest('hex')},
  results,note:'자원 용량 비교이며 작물 적합성·권리·기상·안전의 최종 승인이나 실제 예약이 아닙니다. 미확정 차용은 가용 자원으로 인정하지 않습니다.'};
}
