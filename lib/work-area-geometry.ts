import {z} from 'zod';
import clipping, {type MultiPolygon,type Pair,type Polygon} from 'polygon-clipping';

const point=z.tuple([z.number().min(124).max(132),z.number().min(32).max(39)]);
const ring=z.array(point).min(4).max(2048).refine(r=>r[0][0]===r.at(-1)![0]&&r[0][1]===r.at(-1)![1],'경계를 닫아주세요.');
const polygon=z.array(ring).min(1).max(32);
export const workGeometrySchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('Polygon'),coordinates:polygon}).strict(),
 z.object({type:z.literal('MultiPolygon'),coordinates:z.array(polygon).min(1).max(32)}).strict(),
]).refine(g=>(g.type==='Polygon'?[g.coordinates]:g.coordinates).flat().reduce((n,r)=>n+r.length,0)<=2048,'구역당 꼭짓점은 2,048개까지 검토할 수 있습니다.');
export type WorkGeometry=z.infer<typeof workGeometrySchema>;
export const polygons=(g:WorkGeometry):MultiPolygon=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
const cross=(a:Pair,b:Pair,c:Pair)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const ringArea=(r:Pair[])=>Math.abs(r.slice(1).reduce((n,p,i)=>n+r[i][0]*p[1]-p[0]*r[i][1],0))/2;
const area=(ps:MultiPolygon)=>ps.reduce((n,p)=>n+ringArea(p[0])-p.slice(1).reduce((a,r)=>a+ringArea(r),0),0);
function projection(g:WorkGeometry){
 const [x,y]=polygons(g)[0][0][0],sx=111320*Math.cos(y*Math.PI/180),sy=111320;
 return (other:WorkGeometry)=>polygons(other).map(p=>p.map(r=>r.map(([lon,lat]):Pair=>[(lon-x)*sx,(lat-y)*sy])));
}
function intersects(a:Pair,b:Pair,c:Pair,d:Pair){
 const eps=1e-7,abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
 const on=(p:Pair,q:Pair,r:Pair)=>Math.abs(cross(p,q,r))<=eps&&r[0]>=Math.min(p[0],q[0])-eps&&r[0]<=Math.max(p[0],q[0])+eps&&r[1]>=Math.min(p[1],q[1])-eps&&r[1]<=Math.max(p[1],q[1])+eps;
 return (abC>eps&&abD< -eps||abC< -eps&&abD>eps)&&(cdA>eps&&cdB< -eps||cdA< -eps&&cdB>eps)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function ringsTouch(a:Pair[],b:Pair[]){for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++)if(intersects(a[i-1],a[i],b[j-1],b[j]))return true;return false;}
/** Strictly reject malformed source geometry; clipping must not silently repair it. */
export function validateWorkGeometry(raw:unknown):WorkGeometry{
 const g=workGeometrySchema.parse(raw),ps=projection(g)(g),epsilon=1e-6;
 for(const p of ps){
  for(const r of p){
   if(ringArea(r)<0.01)throw Error('구역 면적이 없거나 너무 작습니다.');
   for(let i=0;i<r.length-1;i++){
    const a=r[i],b=r[i+1],c=r[(i+2)%(r.length-1)];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<epsilon||Math.abs(cross(a,b,c))<epsilon&&(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])<0)throw Error('중복·되돌아가는 경계점이 있습니다.');
    for(let j=i+2;j<r.length-1;j++)if(!(i===0&&j===r.length-2)&&intersects(a,b,r[j],r[j+1]))throw Error('자기 교차 경계는 사용할 수 없습니다.');
   }
  }
  for(let i=1;i<p.length;i++){
   if(ringsTouch(p[0],p[i])||area(clipping.difference([p[i]],[p[0]]))>epsilon)throw Error('제외구역이 바깥 경계 안에 있어야 합니다.');
   for(let j=1;j<i;j++)if(ringsTouch(p[i],p[j])||area(clipping.intersection([p[i]],[p[j]]))>epsilon)throw Error('제외구역이 겹치거나 중첩되었습니다.');
  }
 }
 for(let i=0;i<ps.length;i++)for(let j=0;j<i;j++)if(area(clipping.intersection(ps[i],ps[j]))>epsilon)throw Error('하나의 작업구역 안에서 경계가 겹칩니다.');
 const total=area(ps);if(total<0.01||total>10000000)throw Error('현장 구역 면적이 검토 범위를 벗어났습니다.');
 return g;
}
/** Projected footprint is an approximate review metric, never registry acreage. */
export function validateWorkPartition(parent:WorkGeometry,parts:WorkGeometry[],weights:number[]){
 validateWorkGeometry(parent);
 if(parts.length<2||parts.length>32||parts.length!==weights.length||weights.some(w=>!Number.isFinite(w)||w<=0))throw Error('분할 작업·계획 작업량을 확인하세요.');
 if(parts.reduce((n,g)=>n+polygons(g).flat().reduce((a,r)=>a+r.length,0),0)>8192)throw Error('전체 분할 경계는 꼭짓점 8,192개까지 검토할 수 있습니다.');
 const project=projection(parent),whole=project(parent),total=area(whole),tolerance=Math.max(1e-5,total*1e-9),sum=weights.reduce((a,b)=>a+b,0);
 const pieces=parts.map(p=>project(validateWorkGeometry(p)));
 for(let i=0;i<pieces.length;i++){
  if(area(clipping.difference(pieces[i],whole))>tolerance)throw Error(`${i+1}회차가 현장 확인된 작업구역을 벗어나거나 제외구역을 침범합니다.`);
  for(let j=0;j<i;j++)if(area(clipping.intersection(pieces[i],pieces[j]))>tolerance)throw Error(`${j+1}·${i+1}회차 구역이 겹칩니다.`);
 }
 if(area(clipping.difference(whole,...pieces))>tolerance)throw Error('어느 회차에도 배정되지 않은 작업구역이 남아 있습니다.');
 const rows=pieces.map((p,i)=>({areaM2:area(p),share:area(p)/total,plannedShare:weights[i]/sum}));
 // A 0.5 percentage-point drafting tolerance, not a productivity/safety guarantee.
 if(rows.some(r=>Math.abs(r.share-r.plannedShare)>0.005))throw Error('분할 구역 비율이 승인된 작업량과 다릅니다. 구역 또는 작업량·배차를 다시 검토하세요.');
 return {totalAreaM2:total,parts:rows,shareTolerance:0.005,areaBasis:'LOCAL_PROJECTED_FOOTPRINT' as const};
}
/** An unapproved geometric draft only. Never creates a work record or a route. */
export function draftWorkPartition(parent:WorkGeometry,weights:number[],axis:'EW'|'NS'){
 validateWorkGeometry(parent);
 if(weights.length<2||weights.length>32||weights.some(w=>!Number.isFinite(w)||w<=0))throw Error('분할 작업량을 확인하세요.');
 const ps=polygons(parent),points=ps.flat(2),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],index=axis==='EW'?0:1;
 const project=projection(parent),total=area(project(parent)),sum=weights.reduce((a,b)=>a+b,0),parts:WorkGeometry[]=[];
 let previous=bounds[index]-0.001,cumulative=0;
 const clip=(from:number,to:number):MultiPolygon=>{
  const [x1,y1,x2,y2]=bounds,box:Polygon=[index===0?[[from,y1-0.001],[to,y1-0.001],[to,y2+0.001],[from,y2+0.001],[from,y1-0.001]]:[[x1-0.001,from],[x2+0.001,from],[x2+0.001,to],[x1-0.001,to],[x1-0.001,from]]];
  return clipping.intersection(ps,box);
 };
 for(let i=0;i<weights.length;i++){
  cumulative+=weights[i];let lo=bounds[index],hi=bounds[index+2];
  if(i===weights.length-1)lo=hi=hi+0.001;
  else for(let n=0;n<45;n++){const mid=(lo+hi)/2,cut:WorkGeometry={type:'MultiPolygon',coordinates:clip(bounds[index]-0.001,mid)};if(area(project(cut))<total*cumulative/sum)lo=mid;else hi=mid;}
  const end=(lo+hi)/2;parts.push({type:'MultiPolygon',coordinates:clip(previous,end)});previous=end;
 }
 validateWorkPartition(parent,parts,weights);return parts;
}

/** Preserve the exact reviewed geometry of finished parts and draft only the
 * remaining footprint. Completion and field safety are never inferred. */
export function draftRemainingWorkPartition(parent:WorkGeometry,weights:number[],fixed:Map<number,WorkGeometry>,axis:'EW'|'NS'){
 if(!fixed.size)return draftWorkPartition(parent,weights,axis);
 validateWorkGeometry(parent);
 const open=weights.map((_,i)=>i).filter(i=>!fixed.has(i));
 if(!open.length)throw Error('다시 나눌 미완료 구역이 없습니다.');
 for(const [i,g] of fixed){if(i<0||i>=weights.length)throw Error('고정 회차 오류');validateWorkGeometry(g);}
 const remaining:WorkGeometry={type:'MultiPolygon',coordinates:clipping.difference(polygons(parent),...[...fixed.values()].map(polygons))};
 validateWorkGeometry(remaining);
 const drafts=open.length===1?[remaining]:draftWorkPartition(remaining,open.map(i=>weights[i]),axis);
 const parts=weights.map((_,i)=>fixed.get(i)??drafts[open.indexOf(i)]);
 validateWorkPartition(parent,parts,weights);return parts;
}
