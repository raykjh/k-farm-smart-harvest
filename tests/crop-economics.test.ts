import {it,expect} from 'vitest';
import {economicReferenceSchema,economicReferencesSchema,evaluateCropEconomics,type EconomicReference,type CropEconomicsInput} from '../lib/crop-economics';

const evidence={version:'synthetic-v1',sourceUrl:'https://example.com/synthetic-economic-test',method:'Synthetic arithmetic fixture only',checkedOn:'2026-10-01',validUntil:'2027-12-31'};
const triple=(low:number,base=low,high=base)=>({low,base,high});
const reference=(crop:EconomicReference['crop']='potato'):EconomicReference=>({
 ...evidence,crop,commodity:crop==='rice'?'MILLED_RICE':crop==='pepper'?'DRIED_PEPPER':'FRESH_POTATO',unit:'kg',asOf:'2026-09-30',sourceDataKind:'SYNTHETIC_FIXTURE',origin:'DEMO',harvestPeriod:{from:'2027-01-01',to:'2027-12-31'},
 yieldKgPer1000m2:triple(100,150,200),marketableFraction:triple(.5,.8,1),price:{...triple(1000,1500,2000),unit:'KRW_PER_KG',stage:'FARM_GATE',basis:'HISTORICAL_SCENARIO'},
 cost:{mode:'ITEMIZED',coverage:'ALL_OTHER_COSTS_REVIEWED',components:[{...evidence,category:'SEED_MATERIALS',wonPer1000m2:triple(10000,20000,30000)}]},
});
const wage={year:2027,hourlyWon:12500,halfDayWon:50000,policyVersion:2,source:evidence.sourceUrl};
const input=():CropEconomicsInput=>({areaM2:1000,crop:'potato',commodity:'FRESH_POTATO',origin:'DEMO',harvestPeriod:{from:'2027-05-01',to:'2027-06-01'},today:'2026-10-19',references:[reference()],tasks:[{date:'2027-05-01',durationMinutes:60,ordinaryWorkers:1,machineOperators:0,machineId:null}],payBasis:wage});
it('calculates marketable yield and farm-gate scenarios with conservative four-hour task quotes',()=>{
 const result=evaluateCropEconomics(input());
 expect(result).toMatchObject({status:'ASSESSED',comparable:true,forecast:false,marketableKg:triple(50,120,200),revenue:triple(50000,180000,400000),knownCost:triple(60000,70000,80000),balanceAfterKnownCosts:triple(-30000,110000,340000),unfavorableBalance:-30000});
 const long=input();long.tasks[0].durationMinutes=241;
 expect(evaluateCropEconomics(long).operationalCost.ordinaryLabor).toBe(100000);
});
it('rejects missing, expired, future, ambiguous and mismatched evidence as unknown',()=>{
 for(const patch of [{references:[]},{commodity:'PADDY_RICE'},{origin:'REGISTERED'},{harvestPeriod:null},{harvestPeriod:{from:'2027-12-01',to:'2028-01-01'}},{references:[{...reference(),validUntil:'2026-10-02'}]},{references:[{...reference(),checkedOn:'2026-11-01'}]},{references:[reference(),reference()]},{references:[{...reference(),unit:'tonne'}]}]){
  const result=evaluateCropEconomics({...input(),...patch} as CropEconomicsInput);
  expect(result.status).toBe('UNKNOWN');expect(result.comparable).toBe(false);expect(result.revenue).toBeNull();expect(result.knownCost).toBeNull();expect(result.metrics.unfavorableBalanceWon).toBeNull();
 }
});
it('never treats wholesale prices as farm-gate receipts or a comparable balance',()=>{
 const value=input(),ref=reference();ref.price.stage='WHOLESALE';value.references=[ref];
 expect(evaluateCropEconomics(value)).toMatchObject({status:'PARTIAL',comparable:false,revenue:null,wholesaleScenarioValue:triple(50000,180000,400000),balanceAfterKnownCosts:null});
});
it('keeps absent labor, operator, equipment and other costs visible instead of filling them with zero',()=>{
 const value=input();delete value.payBasis;value.tasks[0].machineId='M1';value.tasks[0].machineOperators=1;
 const ref=reference();ref.cost={mode:'ITEMIZED',coverage:'PARTIAL',components:[]};value.references=[ref];
 const result=evaluateCropEconomics(value);
 expect(result).toMatchObject({comparable:false,costCoverage:'PARTIAL_KNOWN_COSTS',knownCost:null,operationalCost:{ordinaryLabor:null,operatorLabor:null,equipment:null}});
 expect(result.missingComponents).toEqual(expect.arrayContaining(['ORDINARY_LABOR_POLICY_REQUIRED:2027','OPERATOR_LABOR_POLICY_REQUIRED:2027','REGISTERED_EQUIPMENT_RATE_REQUIRED','OTHER_COSTS_INCOMPLETE']));
 expect(result.metrics.baseBalanceWon).toBeNull();
});
it('uses only registered matching equipment rates and explicitly supplied operator wages',()=>{
 const value=input();value.operatorPayBasis=wage;value.tasks[0]={...value.tasks[0],machineId:'M1',machineOperators:1,equipmentRate:{machineId:'M1',wonPerHour:30000,unit:'KRW_PER_HOUR',version:'rate-v1',sourceUrl:evidence.sourceUrl,checkedOn:evidence.checkedOn,validUntil:evidence.validUntil}};
 expect(evaluateCropEconomics(value)).toMatchObject({comparable:true,knownCost:triple(140000,150000,160000),operationalCost:{ordinaryLabor:50000,operatorLabor:50000,equipment:30000}});
 value.tasks[0].equipmentRate!.machineId='M2';expect(evaluateCropEconomics(value).comparable).toBe(false);
 value.tasks[0].equipmentRate!.machineId='M1';value.tasks[0].equipmentRate!.validUntil='2026-12-31';expect(evaluateCropEconomics(value).comparable).toBe(false);
});
it('does not subtract operational labor and equipment again from statistical total costs',()=>{
 const value=input(),ref=reference();ref.cost={...evidence,mode:'STATISTICAL_TOTAL',includesLabor:true,includesEquipment:true,totalWonPer1000m2:triple(60000,70000,80000)};value.references=[ref];
 expect(evaluateCropEconomics(value)).toMatchObject({comparable:true,knownCost:triple(60000,70000,80000),balanceAfterKnownCosts:triple(-30000,110000,340000),operationalCost:{ordinaryLabor:50000,additive:false}});
 value.tasks[0].ordinaryWorkers=10;
 expect(evaluateCropEconomics(value)).toMatchObject({comparable:false,knownCost:triple(60000,70000,80000),missingComponents:['STATISTICAL_TOTAL_BELOW_KNOWN_OPERATIONAL_COST']});
 expect(economicReferenceSchema.safeParse({...ref,cost:{...ref.cost,components:[]}}).success).toBe(false);
 expect(economicReferenceSchema.safeParse({...reference(),cost:{mode:'ITEMIZED',coverage:'PARTIAL',components:[{...evidence,category:'LABOR',wonPer1000m2:triple(1)}]}}).success).toBe(false);
});
it('never uses a statistical cost total to conceal unknown registered labor, operator or equipment costs',()=>{
 const value=input(),ref=reference();ref.cost={...evidence,mode:'STATISTICAL_TOTAL',includesLabor:true,includesEquipment:true,totalWonPer1000m2:triple(1000000)};value.references=[ref];
 delete value.payBasis;value.tasks[0].machineId='M1';value.tasks[0].machineOperators=1;
 const result=evaluateCropEconomics(value);
 expect(result).toMatchObject({status:'PARTIAL',comparable:false,costCoverage:'REFERENCE_TOTAL_ONLY',knownCost:triple(1000000),operationalCost:{ordinaryLabor:null,operatorLabor:null,equipment:null,additive:false},metrics:{baseBalanceWon:null,unfavorableBalanceWon:null}});
 expect(result.missingComponents).toEqual(expect.arrayContaining(['ORDINARY_LABOR_POLICY_REQUIRED:2027','OPERATOR_LABOR_POLICY_REQUIRED:2027','REGISTERED_EQUIPMENT_RATE_REQUIRED']));
});
it('does not make a high-price, labor-intensive crop economically better by omitting labor',()=>{
 const potato=evaluateCropEconomics(input()),value=input(),pepper=reference('pepper');
 pepper.price={...pepper.price,...triple(3000,4000,5000)};value.crop='pepper';value.commodity='DRIED_PEPPER';value.references=[pepper];value.tasks[0].ordinaryWorkers=10;
 const costly=evaluateCropEconomics(value);
 expect(costly.revenue!.base).toBeGreaterThan(potato.revenue!.base);expect(costly.metrics.baseBalanceWon!).toBeLessThan(potato.metrics.baseBalanceWon!);
 delete value.payBasis;expect(evaluateCropEconomics(value).metrics.baseBalanceWon).toBeNull();
});
it('preserves partial known costs, rejects duplicated cost categories and separates demo evidence',()=>{
 const value=input(),ref=reference();if(ref.cost.mode!=='ITEMIZED')throw Error('fixture');ref.cost.coverage='PARTIAL';value.references=[ref];
 expect(evaluateCropEconomics(value)).toMatchObject({comparable:false,knownCost:triple(60000,70000,80000),metrics:{baseBalanceWon:null}});
 expect(economicReferenceSchema.safeParse({...ref,cost:{...ref.cost,components:[ref.cost.components[0],ref.cost.components[0]]}}).success).toBe(false);
 expect(economicReferenceSchema.safeParse({...ref,origin:'REGISTERED'}).success).toBe(false);
 expect(economicReferencesSchema.parse([reference('rice'),reference('potato'),reference('pepper')])).toHaveLength(3);
});
it('does not report a zero known cost when only a required labor rate is missing',()=>{
 const value=input(),ref=reference();delete value.payBasis;ref.cost={mode:'ITEMIZED',coverage:'PARTIAL',components:[]};value.references=[ref];
 expect(evaluateCropEconomics(value)).toMatchObject({knownCost:null,comparable:false,balanceAfterKnownCosts:null});
});
it('uses task-year wage versions and retains known subtotals without laundering missing years',()=>{
 const value=input();delete value.payBasis;value.payByYear={'2027':wage};value.tasks.push({...value.tasks[0],date:'2028-01-01'});
 expect(evaluateCropEconomics(value)).toMatchObject({comparable:false,knownCost:triple(60000,70000,80000),operationalCost:{ordinaryLabor:null},metrics:{baseBalanceWon:null}});
});
it('rejects non-finite arithmetic instead of emitting an apparently comparable infinite return',()=>{
 expect(evaluateCropEconomics({...input(),areaM2:Number.MAX_VALUE})).toMatchObject({status:'UNKNOWN',comparable:false,revenue:null,missingComponents:['ECONOMIC_CALCULATION_OUT_OF_RANGE']});
});
