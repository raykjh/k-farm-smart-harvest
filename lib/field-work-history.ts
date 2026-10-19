import type {buildWorkReport} from './work-report';

type Row=ReturnType<typeof buildWorkReport>['rows'][number];
/** Source-separated, field-owned observations; not an automatic change to safety windows. */
export function fieldDurationSummary(rows:Row[]){
 const groups=new Map<string,{fieldId:string;crop:string;task:string;source:string;count:number;totalMinutes:number}>();
 for(const r of rows){
  if(!r.confirmed||r.executionMinutes===null||r.executionMinutes<=0)continue;
  const key=JSON.stringify([r.fieldId,r.crop,r.task,r.source]);
  const g=groups.get(key)??{fieldId:r.fieldId,crop:r.crop,task:r.task,source:r.source,count:0,totalMinutes:0};
  g.count++;g.totalMinutes+=r.executionMinutes;groups.set(key,g);
 }
 return [...groups.entries()].map(([key,g])=>({key,...g,meanMinutes:Math.round(g.totalMinutes/g.count)}));
}
