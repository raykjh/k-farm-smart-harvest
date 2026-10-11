import type {Prisma} from '@prisma/client';
import {centerRegistry} from './center-registry';
import {recordSpace} from './workspace';
type Point=[number,number];
function segments(g:any):[Point,Point][]{
 const polygons=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[],result:[Point,Point][]=[];
 for(const polygon of polygons??[])for(const ring of polygon??[])for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i];if([a?.[0],a?.[1],b?.[0],b?.[1]].every(Number.isFinite))result.push([a,b]);
 }return result;
}
/** Positive-length shared boundary, not proximity or a shared corner. */
export function directlyAdjacent(a:unknown,b:unknown){
 const left=segments(a),right=segments(b),eps=1e-8;
 for(const [p,q] of left){const dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);if(length<=eps)continue;
  for(const [r,s] of right){
   if(Math.max(p[0],q[0])+eps<Math.min(r[0],s[0])||Math.max(r[0],s[0])+eps<Math.min(p[0],q[0])||Math.max(p[1],q[1])+eps<Math.min(r[1],s[1])||Math.max(r[1],s[1])+eps<Math.min(p[1],q[1]))continue;
   const cross=(v:Point)=>Math.abs(dx*(v[1]-p[1])-dy*(v[0]-p[0]))/length;
   if(cross(r)>eps||cross(s)>eps)continue;
   const project=(v:Point)=>((v[0]-p[0])*dx+(v[1]-p[1])*dy)/length;
   if(Math.min(length,Math.max(project(r),project(s)))-Math.max(0,Math.min(project(r),project(s)))>eps*10)return true;
  }
 }return false;
}
export async function geographicNeighbors(tx:Prisma.TransactionClient,id:string):Promise<string[]>{
 const rows=await tx.workRecord.findMany({where:{kind:'centerGeography',id:'current'}});
 const geometry=(center:string)=>(rows.find(r=>r.workspace===recordSpace(center))?.payload as any)?.geometry;
 const own=geometry(id);if(!own)return [];
 return centerRegistry.filter(c=>c.id!==id&&directlyAdjacent(own,geometry(c.id))).map(c=>c.id);
}
