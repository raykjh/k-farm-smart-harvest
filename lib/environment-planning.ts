import {z} from 'zod';
import {regionalStandardSchema,type SavedRegionalStandard} from './regional-crop-standard';
import {environmentWindows,type WeatherDay} from './environment-window';
export const environmentPlanningSchema=z.object({datasetId:z.string().min(1),standardId:z.string().min(1).optional(),region:z.string().trim().min(1),practice:z.string().trim().min(1),variety:z.string().trim().max(200),from:z.iso.date(),to:z.iso.date()}).strict().refine(v=>v.from<=v.to&&Date.parse(v.to)-Date.parse(v.from)<=732*86400000);
export type EnvironmentSelection=z.infer<typeof environmentPlanningSchema>;
export function planningRegion(field:{address:string;conditions?:{region:string}}){
 return field.conditions?.region.trim()||field.address.match(/^(.+?\s\S+(?:읍|면|동))\s/)?.[1]||'';
}
export type EnvironmentBundle={selection:EnvironmentSelection;standards:SavedRegionalStandard[];days:WeatherDay[];dataset:{id:string;version:number;station:string;period:string;sourceUrl:string}};
export function resolveEnvironment(bundle:EnvironmentBundle,catalogId:string,region:string){
 const query=bundle.selection;
 if(region!==query.region)throw Error('농지와 기상자료 적용 지역이 다릅니다.');
 const matches=bundle.standards.filter(r=>{const p=regionalStandardSchema.parse(r.profile);return p.catalogProfileId===catalogId&&p.status==='REVIEWED'&&p.practice===query.practice&&p.variety===query.variety&&(p.scope==='COMMON'||p.region===region);});
 const local=matches.filter(r=>r.profile.scope!=='COMMON');const candidates=local.length?local:matches;
 if(candidates.length!==1)throw Error(candidates.length?'동일 지역·작형의 기준이 중복됩니다.':'검토된 작물·작형 기준이 없습니다.');
 const selected=candidates[0];
 if(query.standardId&&selected.id!==query.standardId)throw Error('선택한 기준과 적용 우선순위가 다릅니다. 지역 보정 기준을 확인하세요.');
 return {standardId:selected.id,standardVersion:selected.version,dataset:bundle.dataset,operations:selected.profile.operations.filter(o=>o.timingMode==='ENVIRONMENT').map(o=>{
  const result=environmentWindows(o.environment!,bundle.days,query.from,query.to);
  return {code:o.code,rule:o.environment!,...result};
 })};
}
