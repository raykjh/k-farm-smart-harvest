import {z} from 'zod';
import {cropCodeSchema} from './crop-registry';
import {isLegacyCrop} from './crop-registry';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d,'날짜 오류');
export const cultivationSchema=z.object({id:z.string().uuid(),pnu:z.string().regex(/^\d{19}$/),crop:cropCodeSchema,start:date,end:date,previousId:z.string().uuid().optional(),source:z.enum(['REGISTERED','LEGACY_IMPORT']).default('REGISTERED')}).strict().refine(c=>c.start<=c.end,'재배 기간 오류');
export type Cultivation=z.infer<typeof cultivationSchema>&{closedAt?:string;closureCategory?:'WITHDRAWAL'|'CROP_CHANGE'};
export function checkCultivation(next:Cultivation,existing:Cultivation[]){
 existing=existing.filter(c=>!c.closedAt);
 if(existing.some(c=>c.id!==next.id&&c.pnu===next.pnu&&c.start<=next.end&&next.start<=c.end))throw Error('같은 농지의 재배 기간이 겹칩니다.');
 const latest=existing.filter(c=>c.id!==next.id&&c.pnu===next.pnu&&c.end<next.start).sort((a,b)=>a.end.localeCompare(b.end)).at(-1);
 if(latest&&next.previousId!==latest.id)throw Error('직전 재배 건을 연결해야 합니다.');
 if(next.previousId){const p=existing.find(c=>c.id===next.previousId);if(!p||p.pnu!==next.pnu||p.end>=next.start)throw Error('이전 재배 연결·정리 기간 확인 필요');}
}
export const cultivationOperationKey=(id:string,step:string,occurrence=1)=>`cultivation:${id}:${step}${occurrence>1?':'+occurrence:''}`;

type PriorTask={id:string;operationKey?:string|null;cultivationId?:string|null;predecessorKeys?:string[];predecessorMissionIds?:string[];kind?:string};
/** Link actual terminal operations, including split work and repeated harvests.
 * A legacy fallback is only for old plans that predate persisted task graphs. */
export function previousCultivationTerminals(previous:Cultivation,tasks:PriorTask[]):string[]{
 if(previous.closedAt)return [];
 const prefix=`cultivation:${previous.id}:`;
 const rows=tasks.filter(t=>(t.cultivationId===previous.id||t.id.startsWith(prefix)||t.operationKey?.startsWith(prefix))&&!['CONDITIONAL','INSPECTION'].includes(t.kind??''));
 if(rows.length){
  const parents=new Set(rows.flatMap(t=>[...t.predecessorKeys??[],...t.predecessorMissionIds??[]]));
  const leaves=rows.filter(t=>!parents.has(t.id)&&!parents.has(t.operationKey??t.id));
  if(!leaves.length)throw Error('이전 재배의 작업 연결을 확인하세요.');
  return [...new Set(leaves.map(t=>t.operationKey??t.id))];
 }
 if(!isLegacyCrop(previous.crop))throw Error('이전 재배의 마지막 작업·계획 연결이 필요합니다.');
 return [cultivationOperationKey(previous.id,previous.crop==='pepper'?'cleanup':'finish')];
}
