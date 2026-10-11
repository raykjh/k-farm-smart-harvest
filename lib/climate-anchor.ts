import type {CropCode} from './crop-guidelines';
export type NormalDay={monthDay:string;meanC:number};
// Development heuristics, NOT certified crop thresholds or frost-free dates.
export const thermalPolicy={rice:{meanC:15,earliest:'05-01',latest:'06-15'},potato:{meanC:8,earliest:'03-01',latest:'04-15'},pepper:{meanC:15,earliest:'05-01',latest:'05-31'}};
export function suggestAnchors(values:NormalDay[],year:number){
 const result:Partial<Record<CropCode,{planting:string}>>={};
 for(const crop of Object.keys(thermalPolicy) as CropCode[]){const p=thermalPolicy[crop];
 for(const row of [...values].sort((a,b)=>a.monthDay.localeCompare(b.monthDay))){if(row.monthDay<p.earliest||row.monthDay>p.latest)continue;
 const at=Date.parse(`${year}-${row.monthDay}T00:00:00Z`);const sequence=Array.from({length:7},(_,i)=>values.find(d=>d.monthDay===new Date(at+i*86400000).toISOString().slice(5,10)));
 if(sequence.every(d=>d&&Number.isFinite(d.meanC)&&d.meanC>=p.meanC)){result[crop]={planting:`${year}-${row.monthDay}`};break;}
 }}return result;
}
