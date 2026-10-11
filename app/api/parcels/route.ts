import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handleGET(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 const key=process.env.VWORLD_API_KEY?.trim(),domain=process.env.VWORLD_DOMAIN?.trim();
 if(!key||!domain)return reply({status:'NOT_CONFIGURED'},503);
 const q=req.nextUrl.searchParams.get('q')?.trim(),pnu=req.nextUrl.searchParams.get('pnu');
 if(pnu?!/^\d{19}$/.test(pnu):!q||q.length<2||q.length>160)return reply({status:'INVALID_INPUT'},400);
 try{
  const url=new URL(pnu?'https://api.vworld.kr/req/data':'https://api.vworld.kr/req/search');
  const params:Record<string,string>=pnu?{service:'data',request:'GetFeature',data:'LP_PA_CBND_BUBUN',attrFilter:`pnu:=:${pnu}`,geometry:'true',attribute:'true',size:'1'}:{service:'search',request:'search',query:q!,type:'address',category:'parcel',size:'10',page:'1'};
  url.search=new URLSearchParams({...params,version:'2.0',crs:'EPSG:4326',format:'json',errorformat:'json',key,domain}).toString();
  const r=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error();const text=await r.text();if(text.length>1000000)throw Error();
  const data=JSON.parse(text).response;
  if(data?.status==='NOT_FOUND')return reply({status:'EMPTY',items:[]});
  if(data?.status!=='OK')throw Error();
  if(!pnu){const items=(data.result?.items??[]).filter((v:any)=>/^\d{19}$/.test(v.id)&&typeof v.address?.parcel==='string').map((v:any)=>({pnu:v.id,address:v.address.parcel}));return reply({status:items.length?'READY':'EMPTY',items});}
  const feature=data.result?.featureCollection?.features?.find((v:any)=>v.properties?.pnu===pnu);
  if(!feature)return reply({status:'EMPTY'});
  const g=feature.geometry;if(!g||!['Polygon','MultiPolygon'].includes(g.type))throw Error();
  const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  let count=0;for(const polygon of polygons){if(!Array.isArray(polygon)||!polygon.length)throw Error();for(const ring of polygon){if(!Array.isArray(ring)||ring.length<4)throw Error();for(const pt of ring){if(!Array.isArray(pt)||!Number.isFinite(pt[0])||!Number.isFinite(pt[1])||pt[0]<120||pt[0]>135||pt[1]<30||pt[1]>40||++count>20000)throw Error();}if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error();}}
  return reply({status:'READY',pnu,geometry:g,source:'VWorld · 국토교통부 연속지적도',fetchedAt:new Date().toISOString()});
 }catch{return reply({status:'UNAVAILABLE'},502)}
}

export const GET=withAuth('parcels',handleGET);
