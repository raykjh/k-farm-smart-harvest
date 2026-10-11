import type {Mission,State} from './types';
import type {CropCode} from './crop-guidelines';
export type OperationLink={operationKey:string;operationCode:string;occurrence:number;predecessorMissionIds:string[];mappingVersion:string};
export type LinkedMission=Mission&Partial<OperationLink>;
export const mappingVersion='legacy-operation-links-2026-09-11-v1';
// Explicit mapping of the original input dataset, not fuzzy label matching.
const codes:Record<CropCode,string[]>={
 rice:['consultation','seed','nursery','soil','soil','plant','establish','establish','care','treat','heading','harvest-check','harvest','finish','cleanup','settlement'],
 potato:['consultation','seed','soil','plant','emerge','hill','care','treat','harvest-check','harvest','collect','finish','cleanup','settlement'],
 pepper:['consultation','seed','soil','soil','plant','stake','fertilize','care','treat','harvest','harvest','harvest','harvest','harvest','cleanup','settlement'],
};
export const operationKey=(year:number,pnu:string,crop:string,code:string,occurrence=1)=>`${year}:${pnu}:${crop}:${code}${occurrence>1?':'+occurrence:''}`;
export function linkLegacyOperations(state:State,reference:Record<CropCode,[string,string,string?][]>):State{
 const next=structuredClone(state),names={'쌀':'rice','감자':'potato','고추':'pepper'} as const;
 for(const m of next.missions as LinkedMission[]){
  if(!Object.hasOwn(names,m.crop))throw Error('기존 3작물 이관 대상이 아닙니다.');
  const crop=names[m.crop as keyof typeof names],index=Number(m.id.slice(m.fieldId.length+1))-1;
  if(m.id!==`${m.fieldId}-${index+1}`||!reference[crop]?.[index]||reference[crop][index][1]!==m.label||!m.scheduledDate?.startsWith('2026-'))throw Error(`기존 작업 매핑 불일치: ${m.id}`);
  const code=codes[crop][index],occurrence=codes[crop].slice(0,index+1).filter(c=>c===code).length;
  const key=operationKey(2026,m.fieldId,crop,code,occurrence);
  if(m.operationKey&&m.operationKey!==key)throw Error(`기존 작업 키 충돌: ${m.id}`);
  Object.assign(m,{operationKey:key,operationCode:code,occurrence,predecessorMissionIds:index?[`${m.fieldId}-${index}`]:[],mappingVersion});
 }
 if(new Set(next.missions.map(m=>(m as LinkedMission).operationKey)).size!==next.missions.length)throw Error('중복 작업 키');
 return next;
}
