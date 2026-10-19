import {z} from 'zod';
import type {State} from './types';
import type {Cultivation} from './cultivation';
import type {AnnualPlan} from './annual-plan';
import {cropDisplayNames} from './crop-registry';
import {cropReferences} from './crop-reference';

export const ledgerInput=z.object({
 id:z.string().uuid(),supersedesId:z.string().uuid().nullable().default(null),voided:z.boolean().default(false),
 kind:z.enum(['SHIPMENT','WORK_COST','OWNER_PAYMENT']),cultivationId:z.string().uuid(),
 date:z.string().date(),missionId:z.string().max(400).nullable().default(null),
 commodity:z.string().trim().max(100).default(''),quantityKg:z.number().min(0).max(1e9).nullable().default(null),
 amountWon:z.number().int().min(0).max(1e12).nullable().default(null),memo:z.string().trim().min(1).max(1000),
}).strict().superRefine((b,ctx)=>{
 if(b.kind==='SHIPMENT'&&(b.quantityKg===null||!b.commodity))ctx.addIssue({code:'custom',message:'출하량과 생산물 형태를 입력하세요.'});
 if(b.kind!=='SHIPMENT'&&(b.amountWon===null||b.quantityKg!==null))ctx.addIssue({code:'custom',message:'금액을 입력하세요. 출하량은 출하 기록에서만 입력합니다.'});
 if(b.kind==='WORK_COST'&&!b.missionId)ctx.addIssue({code:'custom',message:'비용이 발생한 작업을 선택하세요.'});
 if(b.kind!=='WORK_COST'&&b.missionId)ctx.addIssue({code:'custom',message:'작업 연결은 작업비용 기록에만 사용합니다.'});
 if(b.voided&&!b.supersedesId)ctx.addIssue({code:'custom',message:'취소할 원본 기록이 필요합니다.'});
});
export type LedgerInput=z.infer<typeof ledgerInput>;
export type OperatingEntry=LedgerInput&{fieldId:string;address:string;areaM2:number;crop:string;source:'ACTUAL'|'SIMULATED';task:string|null;actor:string;at:string;requestHash:string};
export function effectiveEntries(entries:OperatingEntry[]){
 const superseded=new Set(entries.flatMap(e=>e.supersedesId?[e.supersedesId]:[]));
 return entries.filter(e=>!superseded.has(e.id)&&!e.voided);
}
export type ForecastRow={cultivationId:string;fieldId:string;address:string;crop:string;areaM2:number;start:string;end:string;source:'ACTUAL'|'SIMULATED';yieldRange:{low:number;high:number}|null;yieldBasis:string;commodity:string};
/** One contribution per cultivation, never per task or repeated harvest.
 * Stored yield bases are reused; unavailable crop/season bases stay null. */
export function forecastRows(state:State,cycles:Cultivation[],plans:AnnualPlan[],year:number):ForecastRow[]{
 const names=cropDisplayNames(true),rows:ForecastRow[]=[];
 for(const c of cycles){
  if(c.closedAt||c.start>`${year}-12-31`||c.end<`${year}-01-01`)continue;
  const plot=plans.flatMap(p=>p.plots??[]).find(p=>p.cultivationId===c.id&&p.pnu===c.pnu),f=state.fields.find(f=>f.id===c.pnu);
  const ref=cropReferences.find(r=>r.id===plot?.referenceId),area=plot?.area??f?.area;
  if(!area)continue;
  const range=c.end.startsWith(String(year))?plot?.yieldRange??null:null;
  rows.push({cultivationId:c.id,fieldId:c.pnu,address:plot?.address??f?.address??c.pnu,crop:names[c.crop],areaM2:area,start:c.start,end:c.end,source:f?.source==='DEMO_ASSUMPTION'?'SIMULATED':'ACTUAL',yieldRange:range,yieldBasis:range?plot?.yieldBasis??'저장된 재배계획 기준':c.end.startsWith(String(year))?'생산량 기준 미등록':'다른 연도 수확 예정',commodity:ref?.commodity??''});
 }
 return rows;
}
export function summarizeForecast(rows:ForecastRow[]){
 const unique=new Map(rows.map(r=>[r.fieldId,r.areaM2]));
 const groups=[...new Set(rows.map(r=>r.crop))].map(crop=>{
  const rs=rows.filter(r=>r.crop===crop),area=new Map(rs.map(r=>[r.fieldId,r.areaM2])),known=rs.filter(r=>r.yieldRange);
  return {crop,fieldCount:area.size,areaM2:[...area.values()].reduce((a,b)=>a+b,0),cultivationAreaM2:rs.reduce((a,r)=>a+r.areaM2,0),cultivationCount:rs.length,missingYield:rs.length-known.length,production:known.length?{low:known.reduce((a,r)=>a+r.yieldRange!.low,0),high:known.reduce((a,r)=>a+r.yieldRange!.high,0)}:null,rows:rs};
 });
 return {fieldCount:unique.size,cropCount:groups.length,areaM2:[...unique.values()].reduce((a,b)=>a+b,0),groups};
}
export function summarizeActual(entries:OperatingEntry[],year:number,source?:'ACTUAL'|'SIMULATED'){
 const rows=effectiveEntries(entries).filter(e=>e.date.startsWith(String(year))&&(!source||e.source===source)).sort((a,b)=>b.date.localeCompare(a.date)||b.at.localeCompare(a.at));
 const crops=[...new Set(rows.map(e=>e.crop))],groups=crops.map(crop=>{
  const rs=rows.filter(e=>e.crop===crop),shipments=rs.filter(e=>e.kind==='SHIPMENT'),costs=rs.filter(e=>e.kind==='WORK_COST'),payments=rs.filter(e=>e.kind==='OWNER_PAYMENT');
  const fields=new Map(shipments.map(e=>[e.fieldId,e.areaM2]));
  const quantities=[...new Set(shipments.map(e=>e.commodity))].map(commodity=>({commodity,kg:shipments.filter(e=>e.commodity===commodity).reduce((n,e)=>n+(e.quantityKg??0),0)}));
  const revenue=shipments.length&&shipments.every(e=>e.amountWon!==null)?shipments.reduce((n,e)=>n+e.amountWon!,0):null;
  const expense=costs.length?costs.reduce((n,e)=>n+e.amountWon!,0):null,ownerPaid=payments.length?payments.reduce((n,e)=>n+e.amountWon!,0):null;
  return {crop,fieldCount:fields.size,areaM2:[...fields.values()].reduce((n,a)=>n+a,0),quantities,revenue,expense,ownerPaid,balance:revenue!==null&&expense!==null&&ownerPaid!==null?revenue-expense-ownerPaid:null,rows:rs};
 });
 const shipped=rows.filter(e=>e.kind==='SHIPMENT'),fields=new Map(shipped.map(e=>[e.fieldId,e.areaM2]));
 return {rows,groups,fieldCount:fields.size,cropCount:new Set(shipped.map(e=>e.crop)).size,areaM2:[...fields.values()].reduce((n,a)=>n+a,0)};
}
