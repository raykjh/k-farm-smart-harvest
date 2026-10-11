import {it,expect} from 'vitest';
import {resolveEnvironment,type EnvironmentBundle} from '../lib/environment-planning';
import {buildAnnualPlan} from '../lib/annual-plan';
import {legacyCatalogProfile} from '../lib/crop-catalog';
import {emptyConditions} from '../lib/field-conditions';
const catalog=legacyCatalogProfile('rice')!;
const bundle=():EnvironmentBundle=>({selection:{datasetId:'test',region:'계북면',practice:'이앙',variety:'test',from:'2028-05-01',to:'2028-05-06'},dataset:{id:'test',version:1,station:'test',period:'test',sourceUrl:'https://example.org'},days:[20,20,5,20,20,20].map((v,i)=>({date:`2028-05-0${i+1}`,meanTemperatureC:v,minTemperatureC:null,soilTemperatureC:null})),standards:[{id:'common',version:1,updatedAt:'test',profile:{catalogProfileId:catalog.id,scope:'COMMON',region:'',practice:'이앙',variety:'test',status:'REVIEWED',reviewer:'fixture',orchardStage:null,yieldLowKgPer1000m2:null,yieldHighKgPer1000m2:null,sourceUrls:['https://example.org'],notes:'Test only',operations:[{code:'seed',name:'test',timingMode:'ENVIRONMENT',environment:{metric:'meanTemperatureC',lowerC:15,upperC:null,consecutiveDays:1,minimumNightC:null},from:'',to:'',crossYear:false,minTemperatureC:null,maxTemperatureC:null,basis:'test',mode:'MANUAL',capability:'',workers:1,operators:0,minutesPer1000m2:60,sourceUrl:'https://example.org'}]}}]});
const field={pnu:'test',address:'test',crop:'rice' as const,group:'',area:1000,mode:'full' as const,rights:'pending' as const,conditions:{...emptyConditions(),region:'계북면'}};
it('prefers exact regional override and rejects duplicate or missing reviewed criteria',()=>{
 const b=bundle();expect(resolveEnvironment(b,catalog.id,'계북면').standardId).toBe('common');
 b.standards.push({...b.standards[0],id:'local',profile:{...b.standards[0].profile,scope:'REGIONAL_OVERRIDE',region:'계북면'}});
 expect(resolveEnvironment(b,catalog.id,'계북면').standardId).toBe('local');
 b.standards.push({...b.standards[1],id:'duplicate'});expect(()=>resolveEnvironment(b,catalog.id,'계북면')).toThrow('중복');
 expect(()=>resolveEnvironment(bundle(),catalog.id,'다른 지역')).toThrow('지역');
 const draft=bundle();draft.standards[0].profile.status='DRAFT';expect(()=>resolveEnvironment(draft,catalog.id,'계북면')).toThrow('없습니다');
});
it('connects disjoint environmental windows without altering IDs, explicit dates or input',()=>{
 const b=bundle(),before=JSON.stringify(b),base=buildAnnualPlan([field],2028,1);
 const plan=buildAnnualPlan([field],2028,1,{},undefined,b),task=plan.plots[0].tasks[0];
 expect(task.id).toBe(base.plots[0].tasks[0].id);expect(task.allowedWindows).toEqual([{from:'2028-05-01',to:'2028-05-02'},{from:'2028-05-04',to:'2028-05-06'}]);expect(JSON.stringify(b)).toBe(before);
 const manual=buildAnnualPlan([field],2028,1,{operations:{rice:{seed:{from:'2028-04-01',to:'2028-04-02'}}}},undefined,b);
 expect(manual.plots[0].tasks[0].window?.from).toBe('2028-04-01');expect(manual.plots[0].tasks[0].allowedWindows).toBeNull();
});
it('no usable temperature leaves work unscheduled instead of filling a date',()=>{
 const b=bundle();b.days=[];const p=buildAnnualPlan([field],2028,1,{},undefined,b);
 expect(p.plots[0].tasks[0].window).toBeNull();expect(p.plots[0].environmental?.operations[0].status).toBe('INSUFFICIENT_DATA');
});
