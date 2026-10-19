import {emptyConditions,recommendConditions,type FieldConditions} from './field-conditions';
import type {Consultation} from './consultation';

export type ParcelGeometry={type:'Polygon';coordinates:number[][][]}|{type:'MultiPolygon';coordinates:number[][][][]};
export type IntakeField=Consultation['fields'][number]&{selected:boolean;geometry?:ParcelGeometry};
export function intakeField(pnu:string,address:string,geometry?:ParcelGeometry):IntakeField{
 return {id:crypto.randomUUID(),pnu,address,area:'',crop:'',mode:'delegated',tenure:'owned',ownerName:'',ownerPhone:'',evidence:'none',end:'',callAt:'',operator:'',callResult:'pending',scope:'',verified:'pending',conditions:emptyConditions(),selected:true,geometry};
}
export function formatBirth(value:string){const d=value.replace(/\D/g,'').slice(0,8);return [d.slice(0,4),d.slice(4,6),d.slice(6,8)].filter(Boolean).join('-')}
export function validBirth(value:string,today:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&value<=today&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value}
export function formatPhone(value:string){const d=value.replace(/\D/g,'').slice(0,11),head=d.startsWith('02')?2:3;return d.length<=head?d:d.length<=head+4?d.slice(0,head)+'-'+d.slice(head):d.slice(0,head)+'-'+d.slice(head,-4)+'-'+d.slice(-4)}

type Point=[number,number];
// A small boundary tolerance is an advisory grouping signal, not access/route proof.
export const intakeRankingPolicy={version:'intake-adjacency-v1',baseWeight:0.95,neighborBonus:5,toleranceMeters:3};
function rings(g?:ParcelGeometry):number[][][]{if(!g)return [];return g.type==='Polygon'?g.coordinates:g.coordinates.flat()}
function segmentDistance(p:Point,a:Point,b:Point){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)}
export function neighboringParcels(a?:ParcelGeometry,b?:ParcelGeometry):boolean{
 const ar=rings(a),br=rings(b),points=[...ar.flat(),...br.flat()];
 if(!ar.length||!br.length||points.length>2000||points.some(p=>p.length<2||!p.slice(0,2).every(Number.isFinite)))return false;
 const lat=points.reduce((s,p)=>s+p[1],0)/points.length,cos=Math.cos(lat*Math.PI/180),origin=points[0];
 const project=(r:number[][])=>r.map(p=>[(p[0]-origin[0])*111320*cos,(p[1]-origin[1])*111320] as Point);
 const aa=ar.map(project),bb=br.map(project),ap=aa.flat(),bp=bb.flat();
 const bounds=(p:Point[])=>[Math.min(...p.map(x=>x[0])),Math.max(...p.map(x=>x[0])),Math.min(...p.map(x=>x[1])),Math.max(...p.map(x=>x[1]))];
 const ab=bounds(ap),bc=bounds(bp),gap=Math.hypot(Math.max(0,ab[0]-bc[1],bc[0]-ab[1]),Math.max(0,ab[2]-bc[3],bc[2]-ab[3]));
 if(gap>intakeRankingPolicy.toleranceMeters)return false;
 for(const [from,to] of [[aa,bb],[bb,aa]])for(const ring of from)for(const p of ring)for(const other of to)for(let i=1;i<other.length;i++)if(segmentDistance(p,other[i-1],other[i])<=intakeRankingPolicy.toleranceMeters)return true;
 return false;
}
export function intakeRecommendations(field:{conditions?:FieldConditions;geometry?:ParcelGeometry;pnu:string},previous:{pnu:string;crop:string;geometry?:ParcelGeometry}[]){
 const neighbors=previous.filter(p=>p.pnu!==field.pnu&&p.crop&&neighboringParcels(field.geometry,p.geometry));
 return recommendConditions(field.conditions).map(r=>{
  const bonus=r.score!==null&&r.status!=='BLOCKED'&&neighbors.some(p=>p.crop===r.crop)?intakeRankingPolicy.neighborBonus:0;
  return {...r,baseScore:r.score,neighborBonus:bonus,score:r.score===null?null:r.status==='BLOCKED'?0:Math.round(r.score*intakeRankingPolicy.baseWeight+bonus),policyVersion:intakeRankingPolicy.version};
 }).sort((a,b)=>(b.status==='BLOCKED'?-2:b.score??-1)-(a.status==='BLOCKED'?-2:a.score??-1));
}
