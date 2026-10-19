import {neighboringParcels} from './registration-intake';
import {coordinateCandidate} from './production-coordination';
import type {FieldEntry} from './field-record';
import type {JointField,JointOption,JointSnapshot} from './integrated-plan';

const overlap=(a:{start:string;end:string},b:{start:string;end:string})=>a.start<=b.end&&b.start<=a.end;
function geometry(field:FieldEntry|undefined,today:string){
 const b=field?.boundary;if(!b||b.checkedOn>today)return undefined;
 // The existing advisory proximity algorithm deliberately bounds its work.
 const rings=b.geometry.type==='Polygon'?b.geometry.coordinates:b.geometry.coordinates.flat();
 return rings.reduce((n,r)=>n+r.length,0)>1000?undefined:b.geometry;
}
export function jointFieldContext(snapshot:Pick<JointSnapshot,'fields'|'sources'>,f:JointField){
 const source=snapshot.sources.find(s=>s.scopeId===f.centerId)!,field=source.fields.find(p=>p.pnu===f.pnu),c=field?.conditions,g=geometry(field,source.today);
 const neighbors=g?snapshot.sources.flatMap(s=>s.fields.filter(p=>p.pnu!==f.pnu&&neighboringParcels(g,geometry(p,s.today))).map(p=>({source:s,field:p}))):[];
 return {
  conditions:{actualUse:c?.landUse??'unknown',cadastralUse:c?.cadastralUse??'NOT_RECORDED',environment:c?.growingEnvironment??'LEGACY_UNSPECIFIED',water:c?.water??'unknown',drainage:c?.drainage??'unknown',machineAccess:c?.machineAccess??'unknown',bearingOrchard:c?.existingBearingOrchard??false},
  neighborhood:{status:g?'BOUNDED_ADVISORY':'UNKNOWN',fieldIds:snapshot.fields.filter(n=>neighbors.some(p=>p.source.scopeId===n.centerId&&p.field.pnu===n.pnu)).map(n=>n.id)},
  option:(o:JointOption)=>({
   climate:c?.climate[o.crop]??'unknown',
   participantSupply:o.coordination?.supply.status??'INSUFFICIENT_DATA',
   nationalOutlook:o.coordination?.market.status??'UNKNOWN',
   specialty:o.coordination?.specialtyStatus??'NOT_REVIEWED',
   establishedNeighborCrops:[...new Set(neighbors.flatMap(n=>n.source.cycles.filter(c=>c.pnu===n.field.pnu&&!c.closedAt&&overlap(c,o.plan.cultivation)).map(c=>c.crop)))].sort(),
  }),
 };
}

/** Recompute against the WHOLE proposed batch, not only fields preceding it.
 * National outlook and participant thresholds remain different signals. */
export function jointDecisionContext(snapshot:JointSnapshot,selected:{field:JointField;option:JointOption}[],production:Parameters<typeof coordinateCandidate>[2]['contributions']){
 const fields=selected.map(({field,option})=>{
  const source=snapshot.sources.find(s=>s.scopeId===field.centerId)!,context=jointFieldContext(snapshot,field);
  const c=option.coordination?coordinateCandidate(option.coordination.production,option.coordination.baseScore,{...source.coordination,contributions:production}):null;
  const facts={...context.option(option),participantSupply:c?.supply.status??'INSUFFICIENT_DATA',nationalOutlook:c?.market.status??'UNKNOWN'};
  const matched=context.neighborhood.fieldIds.some(id=>selected.some(s=>s.field.id===id&&s.option.crop===option.crop&&overlap(s.option.plan.cultivation,option.plan.cultivation)))||facts.establishedNeighborCrops.includes(option.crop);
  return {field:field.id,option:option.id,crop:option.crop,...facts,neighborCompatible:context.neighborhood.status==='UNKNOWN'?null:matched};
 });
 return {fields,metrics:{
  supplyRiskFields:fields.filter(f=>f.nationalOutlook==='OVERSUPPLY_RISK'||['CONCENTRATION','POSSIBLE_CONCENTRATION'].includes(f.participantSupply)).length,
  unassessedMarketFields:fields.filter(f=>f.nationalOutlook==='UNKNOWN').length,
  establishedSpecialtyFields:fields.filter(f=>f.specialty==='ESTABLISHED').length,
  neighborCompatibleFields:fields.filter(f=>f.neighborCompatible===true).length,
  specialtyTrialFields:fields.filter(f=>f.specialty==='DEVELOPMENT_CANDIDATE').length,
 },coverage:'PARTICIPATING_FIELDS_ONLY' as const,priceGuarantee:false as const};
}
