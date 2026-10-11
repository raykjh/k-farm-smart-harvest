import {withAuth} from '@/lib/auth-route';
import {NextRequest} from 'next/server';
export const dynamic='force-dynamic';
async function handleGET(req:NextRequest){
 const h={'Cache-Control':'no-store'};const z=Number(req.nextUrl.searchParams.get('z')),x=Number(req.nextUrl.searchParams.get('x')),y=Number(req.nextUrl.searchParams.get('y'));
 if(![z,x,y].every(Number.isInteger)||z<11||z>18||x<0||y<0||x>=2**z||y>=2**z)return new Response(null,{status:400,headers:h});
 const lon=(x+.5)/2**z*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/2**z)))*180/Math.PI;
 if(lon<127.3||lon>127.95||lat<35.5||lat>36.05)return new Response(null,{status:400,headers:h});
 const key=process.env.VWORLD_API_KEY,domain=process.env.VWORLD_DOMAIN;if(!key||!domain)return new Response(null,{status:503,headers:h});
 const layer=req.nextUrl.searchParams.get('layer');
 if(layer&&layer!=='cadastral')return new Response(null,{status:400,headers:h});
 try{const url=new URL(`https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key.trim())}/Base/${z}/${y}/${x}.png`);
 if(layer==='cadastral'){
  const world=20037508.342789244,span=world*2/2**z;
  url.href='https://api.vworld.kr/req/wms';
  url.search=new URLSearchParams({service:'WMS',request:'GetMap',version:'1.3.0',layers:'lt_c_landinfobasemap',styles:'lt_c_landinfobasemap',crs:'EPSG:3857',bbox:[-world+x*span,world-(y+1)*span,-world+(x+1)*span,world-y*span].join(','),width:'256',height:'256',format:'image/png',transparent:'true',key:key.trim()}).toString();
 }
 url.searchParams.set('domain',domain);const r=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok||!r.headers.get('content-type')?.includes('image/png'))throw Error();const b=await r.arrayBuffer();if(b.byteLength>1000000)throw Error();return new Response(b,{headers:{...h,'Content-Type':'image/png'}})}catch{return new Response(null,{status:502,headers:h})}
}

export const GET=withAuth('map-tile',handleGET);
