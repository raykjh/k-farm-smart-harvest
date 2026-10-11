import {boundaryArea,type CadastreSnapshot} from '../lib/four-center-cadastre';

// Protocol fixture only. The coordinates, parcels and areas are invented and do
// not assert an observed cadastral record or actual administrative topology.
export const syntheticRegions=[
 {centerId:'demo',code:'52740360',name:'계북면'},
 {centerId:'janggye',code:'52740335',name:'장계면'},
 {centerId:'cheoncheon',code:'52740340',name:'천천면'},
 {centerId:'gyenam',code:'52740350',name:'계남면'},
] as const;
export const syntheticCadastre:CadastreSnapshot={
 version:'four-center-cadastre-v1',checkedOn:'2026-10-11',coverage:'BOUNDED_PUBLIC_PARCEL_SAMPLE_NOT_FULL_INVENTORY',requestedPerCenter:25,
 regions:syntheticRegions.map(r=>({...r,pagesRead:1,exhausted:false})),
 parcels:syntheticRegions.flatMap((r,ri)=>Array.from({length:25},(_,i)=>{
  const x=127.4+ri/100+i/1000,y=35.7;
  const geometry={type:'Polygon' as const,coordinates:[[[x,y],[x+0.0004,y],[x+0.0004,y+0.0003],[x,y+0.0003],[x,y]] as [number,number][]]};
  return {pnu:r.code+'99'+String(900000000+i),centerId:r.centerId,townshipCode:r.code,
   address:`${r.name} 합성검증리 ${9000+i}`,landCategory:i<15?'답' as const:i<24?'전' as const:'과' as const,
   areaM2:boundaryArea(geometry),areaBasis:'BOUNDARY_APPROXIMATION_NOT_REGISTER_AREA' as const,geometry,source:'VWorld LP_PA_CBND_BUBUN' as const,checkedOn:'2026-10-11'};
 })),
};
