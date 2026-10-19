import {cropReferences,emptyLedger,estimateProduction,replaceContribution,type ProductionLedger,type Contribution} from './crop-reference';
import type {State,Field} from './types';
// Existing synthetic fields have no confirmed practice/harvest quarter. Never call these national data.
function contribution(f:Field,existing?:Contribution):Contribution|null{
 if(!f.crop)return null;const ref=cropReferences.find(r=>r.crop===f.crop);
 // The operational crop catalog is wider than this legacy yield baseline.
 // Missing yield evidence must not block a registered crop or imply zero yield.
 if(!ref)return null;
 if(existing&&existing.referenceId===ref.id){
  if(existing.areaM2===f.area)return existing;
  // An area edit scales the pinned historical basis, not the latest catalog revision.
  return {...existing,areaM2:f.area,kg:{low:existing.kg.low/existing.areaM2*f.area,high:existing.kg.high/existing.areaM2*f.area}};
 }
 return {id:f.id,referenceId:ref.id,referenceVersion:ref.version,commodity:ref.commodity,period:{year:2026},areaM2:f.area,kg:estimateProduction(f.area,ref),source:'DEMO_ASSUMPTION'};
}
export function syncProduction(s:State):ProductionLedger{
 let ledger=s.productionLedger??emptyLedger();
 for(const f of s.fields)ledger=replaceContribution(ledger,f.id,contribution(f,ledger.entries[f.id]));
 for(const id of Object.keys(ledger.entries))if(!s.fields.some(f=>f.id===id))ledger=replaceContribution(ledger,id,null);
 return ledger;
}
let legacyCache:{signature:string;ledger:ProductionLedger}|undefined;
export function readProduction(s:State):ProductionLedger{
 if(s.productionLedger)return s.productionLedger;
 const signature=JSON.stringify(s.fields.map(f=>[f.id,f.crop,f.area]));
 if(legacyCache?.signature===signature)return legacyCache.ledger;
 const ledger=syncProduction(s);legacyCache={signature,ledger};return ledger;
}
