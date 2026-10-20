import type {NationalBucket} from './national-overview';

/** The operating overview groups crops identically for all registered data.
 * Provenance stays in the source records used by retirement/restore. */
export function nationalDisplayRows(rows:NationalBucket[]){
 const groups=new Map<string,Omit<NationalBucket,'origin'>>();
 for(const row of rows){
  const key=JSON.stringify([row.centerId,row.region,row.crop,row.year,row.quarter]);
  const old=groups.get(key);
  if(!old){const {origin:_,...value}=structuredClone(row);groups.set(key,value);continue;}
  for(const metric of ['cultivations','fields','areaM2','missingArea','plannedAreaM2','approvedAreaM2','growingAreaM2','harvestCompletedAreaM2','pendingPlans','overdue','laborShortages','equipmentHolds','missingYield'] as const)old[metric]+=row[metric];
  for(const p of row.production){const target=old.production.find(v=>v.commodity===p.commodity);if(target){target.low+=p.low;target.high+=p.high;target.cultivations+=p.cultivations}else old.production.push({...p});}
  for(const p of row.shipments){const target=old.shipments.find(v=>v.commodity===p.commodity);if(target){target.kg+=p.kg;target.entries+=p.entries}else old.shipments.push({...p});}
 }
 return [...groups.values()];
}
