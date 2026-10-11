import {z} from 'zod';
import {fetchCenterGeography} from './center-demo-fixture';
import {studyCenterIds,studyCenter,studyDate,capacityStudySchema,contentHash,type CapacityStudyInput} from './capacity-study-input';
import {workloadCrops} from './crop-workload-catalog';

const point=z.tuple([z.number().min(124).max(132),z.number().min(32).max(39)]);
const ring=z.array(point).min(4).max(20000).refine(r=>r[0][0]===r.at(-1)![0]&&r[0][1]===r.at(-1)![1],'경계가 닫히지 않았습니다.');
const polygon=z.array(ring).min(1).max(100);
export const cadastralGeometry=z.discriminatedUnion('type',[
 z.object({type:z.literal('Polygon'),coordinates:polygon}).strict(),
 z.object({type:z.literal('MultiPolygon'),coordinates:z.array(polygon).min(1).max(100)}).strict(),
]);
export const cadastralParcel=z.object({
 pnu:z.string().regex(/^\d{19}$/),centerId:studyCenter,townshipCode:z.string().regex(/^52740\d{3}$/),
 address:z.string().min(1).max(200),landCategory:z.enum(['전','답','과']),areaM2:z.number().positive().max(1000000),
 areaBasis:z.literal('BOUNDARY_APPROXIMATION_NOT_REGISTER_AREA'),geometry:cadastralGeometry,
 source:z.literal('VWorld LP_PA_CBND_BUBUN'),checkedOn:studyDate,
}).strict().refine(p=>p.pnu.startsWith(p.townshipCode),'필지와 면 코드가 다릅니다.');
export type CadastralParcel=z.infer<typeof cadastralParcel>;
export const cadastreSnapshotSchema=z.object({
 version:z.literal('four-center-cadastre-v1'),checkedOn:studyDate,
 coverage:z.literal('BOUNDED_PUBLIC_PARCEL_SAMPLE_NOT_FULL_INVENTORY'),
 requestedPerCenter:z.number().int().min(1).max(100),
 regions:z.array(z.object({centerId:studyCenter,code:z.string().regex(/^52740\d{3}$/),name:z.string().min(1),pagesRead:z.number().int().min(1),exhausted:z.boolean()}).strict()).length(4),
 parcels:z.array(cadastralParcel).min(4).max(400),
}).strict().superRefine((s,c)=>{
 if(new Set(s.regions.map(r=>r.centerId)).size!==4||new Set(s.regions.map(r=>r.code)).size!==4)c.addIssue({code:'custom',message:'센터·면 경계 중복'});
 if(new Set(s.parcels.map(p=>p.pnu)).size!==s.parcels.length)c.addIssue({code:'custom',message:'필지 중복'});
 for(const id of studyCenterIds){const region=s.regions.find(r=>r.centerId===id),rows=s.parcels.filter(p=>p.centerId===id);if(!region||rows.length!==s.requestedPerCenter||rows.some(p=>p.townshipCode!==region.code||!p.address.includes(region.name)))c.addIssue({code:'custom',message:id+': 요청한 필지 표본·지역 확인 필요'});}
});
export type CadastreSnapshot=z.infer<typeof cadastreSnapshotSchema>;

/** Local equal-area approximation for display/planning samples, not cadastral register area. */
export function boundaryArea(raw:unknown){
 const g=cadastralGeometry.parse(raw),polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
 let area=0;
 for(const poly of polys)for(const [index,r] of poly.entries()){
  const lat=r[0][1]*Math.PI/180,xy=r.map(p=>[(p[0]-r[0][0])*111320*Math.cos(lat),(p[1]-r[0][1])*111320]);
  let sum=0;for(let i=1;i<xy.length;i++)sum+=xy[i-1][0]*xy[i][1]-xy[i][0]*xy[i-1][1];
  area+=(index?-1:1)*Math.abs(sum)/2;
 }
 if(area<=0)throw Error('필지 경계 면적 확인 필요');return Math.round(area);
}

export function parseCadastralPage(raw:unknown,region:{centerId:typeof studyCenterIds[number];code:string;name:string},checkedOn:string){
 const data=raw as any,body=data?.response;
 if(body?.status==='NOT_FOUND')return {parcels:[] as CadastralParcel[],exhausted:true};
 if(body?.status!=='OK'||!Array.isArray(body.result?.featureCollection?.features))throw Error('지적도 응답을 확인할 수 없습니다.');
 const features=body.result.featureCollection.features,parcels:CadastralParcel[]=[];
 for(const f of features){
  const p=f.properties,landCategory=typeof p?.jibun==='string'?p.jibun.trim().slice(-1):'';
  if(!['전','답','과'].includes(landCategory))continue;
  // Reject contradictory public records; never relabel a parcel for another center.
  if(typeof p?.pnu!=='string'||!p.pnu.startsWith(region.code)||typeof p?.addr!=='string'||!p.addr.includes(region.name))throw Error('조회 필지의 지역이 일치하지 않습니다.');
  const geometry=cadastralGeometry.parse(f.geometry),areaM2=boundaryArea(geometry);
  if(areaM2<500||areaM2>5000)continue;
  parcels.push(cadastralParcel.parse({pnu:p.pnu,centerId:region.centerId,townshipCode:region.code,address:p.addr,landCategory,areaM2,areaBasis:'BOUNDARY_APPROXIMATION_NOT_REGISTER_AREA',geometry,source:'VWorld LP_PA_CBND_BUBUN',checkedOn}));
 }
 return {parcels,exhausted:features.length<100};
}

/** Read-only public data acquisition, bounded pages and no database writes. */
export async function fetchFourCenterCadastre(perCenter=25,maxPages=12):Promise<CadastreSnapshot>{
 if(!Number.isInteger(perCenter)||perCenter<1||perCenter>100||!Number.isInteger(maxPages)||maxPages<1||maxPages>20)throw Error('조회 범위를 확인하세요.');
 const key=process.env.VWORLD_API_KEY?.trim(),domain=process.env.VWORLD_DOMAIN?.trim();if(!key||!domain)throw Error('VWorld 설정 필요');
 const checkedOn=new Date().toISOString().slice(0,10),parcels:CadastralParcel[]=[],regions:CadastreSnapshot['regions']=[];
 for(const centerId of studyCenterIds){
  const geography=await fetchCenterGeography(centerId),selected=new Map<string,CadastralParcel>();let pagesRead=0,exhausted=false;
  const region={centerId,code:geography.code,name:geography.name};
  for(let page=1;page<=maxPages&&selected.size<perCenter&&!exhausted;page++){
   const url=new URL('https://api.vworld.kr/req/data');url.search=new URLSearchParams({service:'data',request:'GetFeature',data:'LP_PA_CBND_BUBUN',attrFilter:`pnu:like:${region.code}`,geometry:'true',attribute:'true',size:'100',page:String(page),version:'2.0',crs:'EPSG:4326',format:'json',key,domain}).toString();
   let raw:unknown;try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const text=await r.text();if(text.length>5000000)throw Error();raw=JSON.parse(text)}catch{throw Error(centerId+': 지적도 수신 실패. 기존 자료는 변경하지 않았습니다.');}
   const result=parseCadastralPage(raw,region,checkedOn);pagesRead++;exhausted=result.exhausted;
   for(const p of result.parcels)if(selected.size<perCenter)selected.set(p.pnu,p);
  }
  if(selected.size!==perCenter)throw Error(`${centerId}: 표본 ${selected.size}/${perCenter}필지. 가짜 필지를 추가하지 않았습니다.`);
  regions.push({...region,pagesRead,exhausted});parcels.push(...selected.values());
 }
 return cadastreSnapshotSchema.parse({version:'four-center-cadastre-v1',checkedOn,coverage:'BOUNDED_PUBLIC_PARCEL_SAMPLE_NOT_FULL_INVENTORY',requestedPerCenter:perCenter,regions,parcels});
}

/** Geography remains factual. Owner identity, crop suitability and participation
 * are explicit scenario inputs, never inferred evidence of actual ownership. */
export function cadastralStudy(raw:unknown,year:number):CapacityStudyInput{
 const snapshot=cadastreSnapshotSchema.parse(raw);
 const owners=snapshot.parcels.map((_,i)=>({id:'scenario-owner-'+String(i+1).padStart(3,'0')}));
 const input=capacityStudySchema.parse({title:`4센터 실제 지적도 표본 ${year}년 자원계획`,population:{
  basis:'SYNTHETIC_OWNER_POPULATION',description:`실제 지적도 ${snapshot.parcels.length}필지 표본에 가상 소유자를 1명씩 연결한 예시입니다. 실제 전체 농지·소유자 모집단, 실제 작물·지역 적합성 조사 결과가 아닙니다.`,owners,
  parcels:snapshot.parcels.map((p,i)=>({pnu:p.pnu,centerId:p.centerId,areaM2:p.areaM2,ownerId:owners[i].id,applied:true,cropId:p.landCategory==='답'?'rice':p.landCategory==='과'?'apple':'soybean',year,
   geographicBasis:'PUBLIC_CADASTRE',geographicSource:`${p.source} · ${p.checkedOn} · ${p.address} · 경계 근사면적`,
   // The scenario may assume crop suitability; geography does not prove it.
   suitability:'SUITABLE',cropLocked:p.landCategory==='과',existingBearingOrchard:p.landCategory==='과',
   eligibleCropIds:p.landCategory==='답'?['rice']:p.landCategory==='과'?['apple']:workloadCrops.filter(c=>c.category!=='PADDY'&&c.category!=='ORCHARD').map(c=>c.id),
  })),seed:'cadastre-owners-v1',participationRate:0.33},includeConditionalReserve:true,overrides:[]});
 return input;
}
export const cadastreFingerprint=(s:CadastreSnapshot)=>contentHash(s);
