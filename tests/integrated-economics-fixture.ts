import {coordinationPolicySchema} from '../lib/production-coordination';
import type {EconomicReference} from '../lib/crop-economics';
import type {JointSnapshot} from '../lib/integrated-plan';
import {jointSource} from './integrated-plan-fixture';

/** Pure in-memory fixtures. These sources, rates and crop quantities are
 * synthetic DEMO inputs, never observed farming or national market evidence. */
export const economicScenarioEvidence={sourceUrl:'https://example.com/isolated-economic-scenario',method:'SYNTHETIC ONLY: arithmetic and contract verification',checkedOn:'2026-10-01',validUntil:'2027-12-31'};
export const scenarioTriple=(low:number,base=low,high=base)=>({low,base,high});
export const economicScenarioReference=(crop:'potato'|'pepper'):EconomicReference=>({
 ...economicScenarioEvidence,version:'synthetic-economics-v1',asOf:'2026-09-30',sourceDataKind:'SYNTHETIC_FIXTURE',origin:'DEMO',crop,commodity:crop==='potato'?'TEST_FRESH_POTATO':'TEST_DRIED_PEPPER',unit:'kg',harvestPeriod:{from:'2027-01-01',to:'2027-12-31'},
 yieldKgPer1000m2:scenarioTriple(900,1000,1100),marketableFraction:scenarioTriple(1),price:{...scenarioTriple(crop==='potato'?3000:5000,crop==='potato'?4000:6000,crop==='potato'?5000:7000),unit:'KRW_PER_KG',stage:'FARM_GATE',basis:'HISTORICAL_SCENARIO'},
 cost:{...economicScenarioEvidence,version:'synthetic-total-cost-v1',mode:'STATISTICAL_TOTAL',includesLabor:true,includesEquipment:true,totalWonPer1000m2:scenarioTriple(crop==='potato'?1000000:5000000)},
});
export function economicScenarioSource(id='demo',count=2){
 const s=jointSource(id,count);s.criteria.profiles.forEach(p=>p.dataOrigin='DEMO');
 s.laborPayByYear={'2027':{year:2027,hourlyWon:12500,halfDayWon:50000,policyVersion:1,source:economicScenarioEvidence.sourceUrl}};
 s.coordination.policy.economicReferences=[economicScenarioReference('potato'),economicScenarioReference('pepper')];
 s.coordination.policy.yields=s.coordination.policy.economicReferences.map(r=>({...economicScenarioEvidence,crop:r.crop,commodity:r.commodity,kgPer1000m2:{low:900,high:1100}}));
 coordinationPolicySchema.parse(s.coordination.policy);
 return s;
}
export function pricedEconomicScenarioSource(id='demo',count=2){
 const s=economicScenarioSource(id,count);
 s.coordination.policy.operatorCostRates=[{...economicScenarioEvidence,centerId:id,origin:'DEMO',year:2027,hourlyWon:15000,policyVersion:1,version:'synthetic-operator-cost-v1'}];
 s.coordination.policy.equipmentCostRates=s.state!.machines.map(m=>({centerId:m.ownerCenterId??id,machineId:m.id,origin:'DEMO',wonPerHour:30000,unit:'KRW_PER_HOUR',version:'synthetic-equipment-cost-v1',sourceUrl:economicScenarioEvidence.sourceUrl,checkedOn:economicScenarioEvidence.checkedOn,validUntil:economicScenarioEvidence.validUntil}));
 coordinationPolicySchema.parse(s.coordination.policy);
 return s;
}
export const economicScenarioProposal=(snapshot:JointSnapshot,crop:'potato'|'pepper',staffing:'CORE_AND_PEAK'|'PEAK_ONLY'='CORE_AND_PEAK')=>({staffing,choices:snapshot.fields.map(f=>{const option=f.options.find(o=>o.crop===crop);if(!option)throw Error('Requested fixture crop is ineligible');return {field:f.id,option:option.id};})});
