// Read-only VWorld lookup. Never log URLs containing the API key.
export {};
process.loadEnvFile('.env.local');
const params={service:'data',request:'GetFeature',data:'LP_PA_CBND_BUBUN',attrFilter:'pnu:like:5274036023',geometry:'true',attribute:'true',size:'100',page:'1',version:'2.0',crs:'EPSG:4326',format:'json',key:process.env.VWORLD_API_KEY!.trim(),domain:process.env.VWORLD_DOMAIN!.trim()};
const selected:any[]=[];
for(let page=1;page<=12;page++){
 const r=await fetch('https://api.vworld.kr/req/data?'+new URLSearchParams({...params,page:String(page)}),{signal:AbortSignal.timeout(15000)});
 const data=(await r.json()).response;if(data.status!=='OK')throw Error('Lookup unavailable');
 for(const f of data.result?.featureCollection?.features??[]){
  const land=f.properties.jibun.trim().slice(-1);if(!['전','답'].includes(land))continue;
  const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  let area=0;for(const poly of polygons){for(let ri=0;ri<poly.length;ri++){const ring=poly[ri],lat=ring[0][1]*Math.PI/180;let sum=0;const xy=ring.map((p:number[])=>[(p[0]-ring[0][0])*111320*Math.cos(lat),(p[1]-ring[0][1])*111320]);for(let i=1;i<xy.length;i++)sum+=xy[i-1][0]*xy[i][1]-xy[i][0]*xy[i-1][1];area+=(ri?-1:1)*Math.abs(sum)/2;}}
  if(area<500||area>15000||selected.some(x=>x.pnu===f.properties.pnu)||selected.filter(x=>x.land===land).length>=(land==='답'?10:20))continue;
  selected.push({pnu:f.properties.pnu,address:f.properties.addr,land,area:Math.round(area),areaSource:'BOUNDARY_APPROXIMATION_NOT_REGISTER_AREA',source:'VWorld LP_PA_CBND_BUBUN',checkedAt:new Date().toISOString().slice(0,10)});
 }
 if(selected.length===30)break;
}
console.log(JSON.stringify(selected));
