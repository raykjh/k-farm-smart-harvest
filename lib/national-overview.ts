import type {State,Mission} from './types';
import type {Cultivation} from './cultivation';
import type {AnnualPlan} from './annual-plan';
import {cropCodes,type SupportedCropCode} from './crop-registry';
import {cropReferences} from './crop-reference';
import {effectiveEntries,type OperatingEntry} from './operating-ledger';
import {buildWorkReport,type ReportEvidence} from './work-report';
import {harvestPeriod} from './production-coordination-store';
import {recordSpace} from './workspace';
import {syntheticRegistrationPnus} from './registration-origin';
export type NationalFilter={year:number;quarter?:number;crop?:SupportedCropCode;region?:string;center?:string;origin?:'DEMO'|'REGISTERED'};
export type NationalCenterInput={id:string;state:State;version:number};
export type NationalRecord={workspace:string;kind:string;id:string;payload:unknown};
export type NationalBucket={centerId:string;centerName:string;region:string;crop:SupportedCropCode;origin:'DEMO'|'REGISTERED';year:number;quarter:number|null;cultivations:number;fields:number;areaM2:number;missingArea:number;plannedAreaM2:number;approvedAreaM2:number;growingAreaM2:number;harvestCompletedAreaM2:number;pendingPlans:number;overdue:number;laborShortages:number;equipmentHolds:number;production:{commodity:string;low:number;high:number;cultivations:number}[];missingYield:number;shipments:{commodity:string;kg:number;entries:number}[]};
const region=(pnu:string)=>/^\d{19}$/.test(pnu)?pnu.slice(0,5):'UNKNOWN';
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
/** Returns aggregates only. Farmer names, contacts, parcel IDs and addresses never leave this boundary. */
export function buildNationalOverview(centers:NationalCenterInput[],records:NationalRecord[],filter:NationalFilter,today:string){
 const groups=new Map<string,NationalBucket>(),fieldSets=new Map<string,Set<string>>(),centerSummaries:{id:string;name:string;longitude:number|null;latitude:number|null;version:number;rows:number}[]=[];
 const workspaces=new Map<string,NationalRecord[]>();for(const r of records){const list=workspaces.get(r.workspace)??[];list.push(r);workspaces.set(r.workspace,list);}
 for(const center of centers){
  const state=center.state,rows=workspaces.get(recordSpace(center.id))??[],cycles=rows.filter(r=>r.kind==='cultivation').map(r=>r.payload as Cultivation),plans=new Map(rows.filter(r=>r.kind==='cultivationPlan').map(r=>[r.id,r.payload as AnnualPlan]));
  const settings=rows.find(r=>r.kind==='centerSettings')?.payload as {location?:{longitude:number;latitude:number}}|undefined;
  const evidence=rows.filter(r=>r.kind==='taskExecutionAssessment').map(r=>r.payload as ReportEvidence),reports=buildWorkReport(state,evidence,today),reportById=new Map(reports.rows.map(r=>[r.missionId,r]));
  const preparedPnus=syntheticRegistrationPnus(rows.filter(r=>r.kind==='registrationOrigin').map(r=>r.payload));
  const fields=new Map(state.fields.map(f=>[f.id,f])),missionGroups=new Map<string,Mission[]>();
  for(const m of state.missions){if(m.resourceOccupancyOnly)continue;const cycleId=(m as Mission&{cultivationId?:string}).cultivationId??m.id.match(/^cultivation:([^:]+):/)?.[1];if(!cycleId)continue;const list=missionGroups.get(cycleId)??[];list.push(m);missionGroups.set(cycleId,list);}
  function bucket(c:Cultivation,plan:AnnualPlan|undefined,shipmentDate?:string){
   if(!cropCodes.includes(c.crop))return;
   const plot=plan?.plots?.find(p=>p.pnu===c.pnu),field=fields.get(c.pnu),period=plan?harvestPeriod(plan):null,harvestEnd=period?.to??c.end;
   const date=shipmentDate??harvestEnd,year=Number(date.slice(0,4)),quarter=!shipmentDate&&period&&period.from.slice(0,4)!==period.to.slice(0,4)?null:Math.ceil(Number(date.slice(5,7))/3),regionCode=region(c.pnu),origin=preparedPnus.has(c.pnu)||field?.source==='DEMO_ASSUMPTION'||plan?.context?.catalog?'DEMO':'REGISTERED';
   if(year!==filter.year||filter.quarter&&quarter!==filter.quarter||filter.crop&&c.crop!==filter.crop||filter.region&&!regionCode.startsWith(filter.region)||filter.center&&center.id!==filter.center||filter.origin&&filter.origin!==origin)return;
   const key=JSON.stringify([center.id,regionCode,c.crop,origin,year,quarter]);
   const g=groups.get(key)??{centerId:center.id,centerName:state.name||center.id,region:regionCode,crop:c.crop,origin,year,quarter,cultivations:0,fields:0,areaM2:0,missingArea:0,plannedAreaM2:0,approvedAreaM2:0,growingAreaM2:0,harvestCompletedAreaM2:0,pendingPlans:0,overdue:0,laborShortages:0,equipmentHolds:0,production:[],missingYield:0,shipments:[]};
   groups.set(key,g);const knownFields=fieldSets.get(key)??new Set<string>();const area=positive(plot?.area)?plot.area:positive(field?.area)?field.area:null;
   if(!knownFields.has(c.pnu)){knownFields.add(c.pnu);g.fields++;if(area)g.areaM2+=area;else g.missingArea++;}fieldSets.set(key,knownFields);
   return {g,area,plot};
  }
  function addCycle(c:Cultivation,plan:AnnualPlan|undefined,draft:boolean){
   if(c.closedAt)return;
   const result=bucket(c,plan);if(!result)return;const {g,area,plot}=result;
   if(draft){g.pendingPlans++;g.plannedAreaM2+=area??0;return;}
   g.cultivations++;g.approvedAreaM2+=area??0;
   const missions=missionGroups.get(c.id)??[],harvest=plot?.tasks.filter(t=>t.operationCode==='harvest')??[];
   const harvestMissions=missions.filter(m=>harvest.some(t=>m.id===t.id||(m as Mission&{operationKey?:string}).operationKey===t.id||m.id.startsWith(t.id+':')));
   const harvested=harvest.length>0&&harvest.every(t=>harvestMissions.some(m=>m.id===t.id||(m as Mission&{operationKey?:string}).operationKey===t.id||m.id.startsWith(t.id+':')))&&harvestMissions.every(m=>reportById.get(m.id)?.confirmed);
   if(harvested)g.harvestCompletedAreaM2+=area??0;else if(c.start<=today&&today<=c.end)g.growingAreaM2+=area??0;
   for(const m of missions){const report=reportById.get(m.id);if(report?.overdue)g.overdue++;if(m.status==='UNSTAFFED'||m.laborRecoveryRequired)g.laborShortages++;if(m.status==='HELD'&&m.resourceId)g.equipmentHolds++;}
   const commodity=cropReferences.find(r=>r.id===plot?.referenceId)?.commodity,range=plot?.yieldRange;
   if(commodity&&range&&Number.isFinite(range.low)&&range.low>=0&&Number.isFinite(range.high)&&range.high>=range.low){const p=g.production.find(p=>p.commodity===commodity)??{commodity,low:0,high:0,cultivations:0};if(!g.production.includes(p))g.production.push(p);p.low+=range.low;p.high+=range.high;p.cultivations++;}else g.missingYield++;
  }
  for(const cycle of cycles)addCycle(cycle,plans.get(cycle.id),false);
  const view=rows.find(r=>r.kind==='continuousProduction')?.payload as {items?:{status:string;proposal?:{cultivation:Cultivation;plan:AnnualPlan}|null}[]}|undefined;
  const existing=new Set(cycles.map(c=>c.id)),seenDrafts=new Set<string>();
  for(const item of view?.items??[]){const proposal=item.proposal;if(item.status!=='REVIEW'||!proposal||existing.has(proposal.cultivation.id)||seenDrafts.has(proposal.cultivation.id))continue;seenDrafts.add(proposal.cultivation.id);addCycle(proposal.cultivation,proposal.plan,true);}
  const entries=effectiveEntries(rows.filter(r=>r.kind==='operatingLedger').map(r=>r.payload as OperatingEntry));
  const cycleById=new Map(cycles.map(c=>[c.id,c]));
  // Actual shipments survive closure and follow their own recorded date, even
  // when the harvest belongs to another year or quarter.
  for(const e of entries){if(e.kind!=='SHIPMENT'||e.quantityKg===null)continue;const cycle=cycleById.get(e.cultivationId);if(!cycle)continue;const result=bucket(cycle,plans.get(cycle.id),e.date);if(!result)continue;const g=result.g,s=g.shipments.find(s=>s.commodity===e.commodity)??{commodity:e.commodity,kg:0,entries:0};if(!g.shipments.includes(s))g.shipments.push(s);s.kg+=e.quantityKg;s.entries++;}
  const location=settings?.location,longitude=location&&Number.isFinite(location.longitude)&&location.longitude>=124&&location.longitude<=132?location.longitude:null,latitude=location&&Number.isFinite(location.latitude)&&location.latitude>=32&&location.latitude<=39?location.latitude:null;
  centerSummaries.push({id:center.id,name:state.name||center.id,longitude,latitude,version:center.version,rows:[...groups.values()].filter(g=>g.centerId===center.id).length});
 }
 return nationalResult([...groups.values()],centerSummaries,filter,today);
}
function nationalResult(input:NationalBucket[],centerSummaries:{id:string;name:string;longitude:number|null;latitude:number|null;version:number;rows:number}[],filter:NationalFilter,today:string){
 const rows=input.sort((a,b)=>JSON.stringify([a.centerId,a.region,a.crop,a.origin,a.quarter]).localeCompare(JSON.stringify([b.centerId,b.region,b.crop,b.origin,b.quarter])));
 return {asOf:today,filter,coverage:'PARTICIPATING_CULTIVATIONS_ONLY' as const,unregisteredRegions:'UNCOUNTED' as const,rows,centers:centerSummaries,summary:{centers:rows.length?new Set(rows.map(r=>r.centerId)).size:0,cultivations:rows.reduce((n,r)=>n+r.cultivations,0),pendingPlans:rows.reduce((n,r)=>n+r.pendingPlans,0),approvedAreaM2:rows.reduce((n,r)=>n+r.approvedAreaM2,0),growingAreaM2:rows.reduce((n,r)=>n+r.growingAreaM2,0),harvestCompletedAreaM2:rows.reduce((n,r)=>n+r.harvestCompletedAreaM2,0),overdue:rows.reduce((n,r)=>n+r.overdue,0),missingYield:rows.reduce((n,r)=>n+r.missingYield,0)}};
}
/** Centers are disjoint, so only their privacy-safe buckets need to be retained. */
export function combineNationalOverviews(parts:ReturnType<typeof buildNationalOverview>[],filter:NationalFilter,today:string){
 return nationalResult(parts.flatMap(p=>p.rows),parts.flatMap(p=>p.centers),filter,today);
}
