import {capacityStudySchema} from '../lib/capacity-study-input';
import {workloadCrops} from '../lib/crop-workload-catalog';

/** Synthetic identities and parcels: never a claim about actual ownership. */
export const capacityScaleFixture=()=>capacityStudySchema.parse({title:'혼잡 검증',population:{basis:'SYNTHETIC_OWNER_POPULATION',description:'가상 소유자·필지 규모 검증, 실제 지적도 아님',seed:'congestion-20261003',participationRate:0.33,owners:Array.from({length:400},(_,i)=>({id:'owner-'+i})),parcels:Array.from({length:400},(_,i)=>({pnu:String(i+1).padStart(19,'0'),ownerId:'owner-'+i,centerId:['demo','janggye','cheoncheon','gyenam'][i%4],areaM2:1000,applied:true,cropId:workloadCrops[i%30].id,year:2027,geographicBasis:'SYNTHETIC_TEST_ONLY',geographicSource:'isolated scale validation',suitability:'SUITABLE',cropLocked:false,existingBearingOrchard:i%30>=25}))},includeConditionalReserve:true,overrides:[]});
