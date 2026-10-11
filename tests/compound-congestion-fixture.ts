import {directlyAdjacent} from '../lib/center-adjacency';
import {capacityStudySchema,studyCenterIds,type StudyIncident} from '../lib/capacity-study-input';
import {summarizeCapacity} from '../lib/capacity-workload';
import type {StudyCalculationContext} from '../lib/capacity-study-scheduling';
import {capacityScaleFixture} from './capacity-scale-fixture';

/** Synthetic squares test shared edges, never actual township boundaries. */
export const compoundGeography=Object.fromEntries(studyCenterIds.map((id,i)=>{
 const x=i%2,y=Math.floor(i/2);
 return [id,{type:'Polygon',coordinates:[[[x,y],[x+1,y],[x+1,y+1],[x,y+1],[x,y]]]}];
}));
export const compoundNeighbors=Object.fromEntries(studyCenterIds.map(id=>[id,studyCenterIds.filter(other=>other!==id&&directlyAdjacent(compoundGeography[id],compoundGeography[other]))]));

export function compoundCapacityFixture(scale=false){
 const input=scale?capacityScaleFixture():capacityStudySchema.parse({title:'복합 혼잡 검증',population:{basis:'SYNTHETIC_OWNER_POPULATION',description:'Synthetic owner, parcel and resource input; not real staffing or agricultural advice',seed:'compound',participationRate:1,
  owners:studyCenterIds.map(id=>({id:'owner-'+id})),parcels:studyCenterIds.map((centerId,i)=>({pnu:String(i+1).padStart(19,'0'),ownerId:'owner-'+centerId,centerId,areaM2:1000,applied:true,cropId:i%2?'pepper':'rice',year:2027,geographicBasis:'SYNTHETIC_TEST_ONLY',geographicSource:'isolated compound verification',suitability:'SUITABLE',cropLocked:false,existingBearingOrchard:false}))},includeConditionalReserve:true,overrides:[]});
 // Explicit scenario input: one short harvest window, not a production rule.
 input.overrides.push(...['harvest','finish'].map(operationCode=>({cropId:'rice',operationCode,windows:[{from:'2027-09-20',to:'2027-09-26'}],basis:'DEMO_INPUT' as const,source:'Isolated seven-day congestion window'})));
 const summary=summarizeCapacity(input),from='2027-09-20',to='2027-09-26';
 // The small case declares a three-person baseline before either comparison.
 // No staff, transport or machine is added after an incident occurs.
 if(!scale)for(const c of summary.baseline.centers)c.workers=3;
 const broken=summary.baseline.machines.find(m=>m.ownerCenterId==='demo'&&m.capability==='CB')!;
 const replacement=summary.baseline.machines.find(m=>m.ownerCenterId==='cheoncheon'&&m.capability==='CB')!;
 const incidents:StudyIncident[]=[{kind:'FAULT',machineId:broken.id,from,to},{kind:'LABOR_ABSENCE',centerId:'demo',workers:1,from,to}];
 const context:StudyCalculationContext={neighbors:compoundNeighbors,loans:[{machineId:replacement.id,borrowerCenterId:'demo',from,to,transferSlots:4,operatorAndTransportConfirmed:true,permission:'ASSUMED_FOR_STUDY'}],incidents};
 return {input,summary,context,broken,replacement,from,to};
}
