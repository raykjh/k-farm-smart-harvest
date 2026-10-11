import {NextRequest,NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {regionQuery} from '@/lib/region-directory';
export const dynamic='force-dynamic';
async function handleGET(req:NextRequest){
 const level=req.nextUrl.searchParams.get('level')??'province',parent=req.nextUrl.searchParams.get('parent')??'',code=req.nextUrl.searchParams.get('code')??'';
 let config;try{config=regionQuery(level,parent,code)}catch{return NextResponse.json({error:'지역 코드 형식 확인 필요'},{status:400})}
 const key=process.env.VWORLD_API_KEY?.trim(),domain=process.env.VWORLD_DOMAIN?.trim();if(!key||!domain)return NextResponse.json({error:'지도 API 설정 필요'},{status:503});
 try{
  const url=new URL('https://api.vworld.kr/req/data');url.search=new URLSearchParams({service:'data',request:'GetFeature',version:'2.0',data:config.data,format:'json',crs:'EPSG:4326',size:'1000',page:'1',geometry:code?'true':'false',attribute:'true',key,domain}).toString();
  if(code||parent)url.searchParams.set('attrFilter',`${config.code}:${code?'=':'like'}:${code||parent}`);else url.searchParams.set('geomFilter','BOX(124,32,132,39)');
  const response=await fetch(url,{next:{revalidate:86400},redirect:'error',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();const raw=await response.text();if(raw.length>8000000)throw Error();const data=JSON.parse(raw).response;
  if(data?.status==='NOT_FOUND')return NextResponse.json({items:[],source:'VWorld',fetchedAt:new Date().toISOString()});if(data?.status!=='OK')throw Error();
  const features=data.result?.featureCollection?.features;if(!Array.isArray(features))throw Error();
  const items=features.flatMap((f:any)=>{const id=String(f.properties?.[config.code]??''),name=f.properties?.[config.name];if(!new RegExp(`^\\d{${config.length}}$`).test(id)||typeof name!=='string'||(code?id!==code:parent&&!id.startsWith(parent)))return [];return [{code:id,name,geometry:code?f.geometry:null}]});
  return NextResponse.json({items,source:'VWorld · 국토교통부',sourceUrl:'https://www.vworld.kr',fetchedAt:new Date().toISOString(),complete:Number(data.record?.total??items.length)<=features.length});
 }catch{return NextResponse.json({error:'공식 지역 자료 수신 실패. 임의 지역 목록으로 대체하지 않았습니다.'},{status:502})}
}
export const GET=withAuth('regions',handleGET);
