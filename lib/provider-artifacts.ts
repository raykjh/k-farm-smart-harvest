import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';

// Optional server-side provider inputs. Never bundled as an unconditional JSON
// import and never replaced with invented geography in an operating request.
export const providerArtifactPaths={
 registeredParcels:{name:'registered-demo-parcels.json',legacy:'lib/demo-parcels.json'},
 cadastre:{name:'four-center-cadastre.json',legacy:'data/capacity/four-center-cadastre-2026-10-03.json'},
 capacityStudy:{name:'four-center-study.json',legacy:'data/capacity/four-center-study-2026.json'},
} as const;
export type ProviderArtifact=keyof typeof providerArtifactPaths;
export class ProviderArtifactError extends Error{
 constructor(public code:'PROVIDER_DATA_REQUIRED'|'PROVIDER_DATA_INVALID'){
  super(code==='PROVIDER_DATA_REQUIRED'?'외부 지적도 입력 파일을 먼저 준비하세요. 기존 업무 자료는 변경하지 않았습니다.':'외부 지적도 입력 형식을 확인하세요. 기존 업무 자료는 변경하지 않았습니다.');
 }
}
export function readProviderArtifact(kind:ProviderArtifact,options:{directory?:string;legacy?:boolean}={}):unknown|null{
 const file=providerArtifactPaths[kind];
 const directory=options.directory??(process.env.KFARM_PROVIDER_DATA_DIR?.trim()||resolve('.data/provider-samples'));
 const candidates=[resolve(directory,file.name),...(options.legacy===false?[]:[resolve(file.legacy)])];
 for(const path of candidates){
  let size:number;
  try{const stat=statSync(path);if(!stat.isFile())throw new ProviderArtifactError('PROVIDER_DATA_INVALID');size=stat.size;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw new ProviderArtifactError('PROVIDER_DATA_INVALID');}
  if(size>10*1024*1024)throw new ProviderArtifactError('PROVIDER_DATA_INVALID');
  try{return JSON.parse(readFileSync(path,'utf8'));}catch{throw new ProviderArtifactError('PROVIDER_DATA_INVALID');}
 }
 return null;
}
export function requireProviderArtifact(kind:ProviderArtifact){
 const value=readProviderArtifact(kind);if(value===null)throw new ProviderArtifactError('PROVIDER_DATA_REQUIRED');return value;
}
