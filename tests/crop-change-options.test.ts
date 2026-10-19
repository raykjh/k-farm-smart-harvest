import {it,expect} from 'vitest';
import {cropChangeOptions} from '../lib/crop-change-options';
import {cropCodes} from '../lib/crop-registry';
import {WORKLOAD_CATALOG_VERSION} from '../lib/crop-workload-catalog';
import {emptyConditions} from '../lib/field-conditions';
import {buildAnnualPlan} from '../lib/annual-plan';
import type {FieldEntry} from '../lib/field-record';
import type {ProductionCriteria} from '../lib/continuous-production';
const field:FieldEntry={pnu:'5274036023110930000',address:'격리 농지',area:1000,mode:'full',crop:'potato',group:'',rights:'pending',conditions:{...emptyConditions(),landUse:'upland',water:'yes',drainage:'good',machineAccess:'yes',laborAvailable:'yes',region:'계북면',climate:Object.fromEntries(cropCodes.map(c=>[c,'suitable'])) as any,evidence:'격리 테스트 입력',checkedOn:'2026-01-01'}};
const profiles:ProductionCriteria['profiles']=[{id:'test',name:'테스트 연간 작업 기준',context:{region:'계북면',catalog:{version:WORKLOAD_CATALOG_VERSION,year:2026,dataOrigin:'DEMO',sourceBatchId:'test'}}}];
it('offers autumn planting now and spring planting next year, not the current harvest season',()=>{
 const {choices}=cropChangeOptions(field,profiles,'2026-10-15');
 expect(choices.filter(c=>c.season==='THIS_YEAR').map(c=>c.crop).sort()).toEqual(['barley','garlic','onion','wheat']);
 expect(choices.find(c=>c.crop==='potato')).toMatchObject({season:'NEXT_YEAR',plantingFrom:'2027-03-15'});
 expect(choices.some(c=>c.crop==='rice'||c.crop==='apple')).toBe(false);
 expect(choices.every(c=>c.start>'2026-10-15'&&c.plantingFrom>='2026-10-16')).toBe(true);
 for(const choice of choices){const plan=buildAnnualPlan([{...field,crop:choice.crop}],Number(choice.start.slice(0,4)),1,choice.context,{id:'5e282bdf-45be-49bf-a646-fba045414d4d',pnu:field.pnu,crop:choice.crop,start:choice.start,end:choice.end,source:'REGISTERED'});expect(plan.plots[0].tasks.every(t=>t.window&&t.window.from>=choice.start&&t.window.to<=choice.end)).toBe(true);}
});
it('filters paddy, orchard and missing land/climate evidence instead of inventing suitability',()=>{
 const paddy={...field,conditions:{...field.conditions!,landUse:'paddy' as const}};
 expect([...new Set(cropChangeOptions(paddy,profiles,'2026-10-15').choices.map(c=>c.crop))]).toEqual(['rice']);
 expect(cropChangeOptions({...field,conditions:undefined},profiles,'2026-10-15').choices).toEqual([]);
 expect(cropChangeOptions({...field,conditions:{...field.conditions!,landUse:'orchard'}},profiles,'2026-10-15').choices).toEqual([]);
 expect(cropChangeOptions(field,profiles.map(p=>({...p,context:{...p.context,region:'다른면'}})),'2026-10-15').choices).toEqual([]);
});
it('changes candidate identifiers when today or parcel conditions change',()=>{
 const before=cropChangeOptions(field,profiles,'2026-10-15').choices;
 const after=cropChangeOptions(field,profiles,'2026-10-16').choices;
 expect(before.length).toBeGreaterThan(0);expect(after.every(a=>!before.some(b=>b.id===a.id))).toBe(true);
});
