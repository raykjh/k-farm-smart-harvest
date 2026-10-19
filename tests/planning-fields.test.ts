import {it,expect} from 'vitest';
import {buildAnnualPlan} from '../lib/annual-plan';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {connectPlanningFields} from '../lib/planning-fields';
import {registeredDemo} from './registered-demo-fixture';
import {completedSteps} from './planning-fixtures';
const input={pnu:'5274036023106160004',address:'등록 농지',crop:'rice' as const,group:'',area:3000,mode:'joint' as const,rights:'pending' as const};
const plan=(area=3000)=>buildAnnualPlan([{...input,area}],2027,1,{anchors:{rice:{planting:'2027-05-25'}}});
it('uses the same capacity engine for ordinary registrations and demo records',async ()=>{
 const s=registeredDemo().state;s.missions=completedSteps(input.pnu,2027,'rice',['nursery','soil']);
 const empty={...s,fields:[]};
 expect((await previewAnnualDispatch(plan(),empty,'2027-05-01')).assignments).toEqual((await previewAnnualDispatch(plan(),s,'2027-05-01')).assignments);
 expect((await previewAnnualDispatch(plan(),empty,'2027-05-01')).assignments).toHaveLength(1);
});
it('projects new fields without inventing a farmer or consent, and preserves history',()=>{
 const s=registeredDemo().state;s.fields=[];
 const next=connectPlanningFields(plan(),s);
 expect(next.fields[0]).toMatchObject({source:'REGISTERED',farmerId:'',confirmed:false,area:3000,crop:'쌀'});
 expect(next.missions).toEqual(s.missions);expect(s.fields).toHaveLength(0);
 expect(connectPlanningFields(plan(6000),next).fields).toHaveLength(1);
 expect(connectPlanningFields(plan(6000),next).fields[0].area).toBe(6000);
});
it('responds to parcel area and equipment availability without changing engine',async ()=>{
 const s=registeredDemo().state;s.missions=completedSteps(input.pnu,2027,'rice',['nursery','soil']);s.fields=[];
 const small=(await previewAnnualDispatch(plan(),s,'2027-05-01')).assignments[0];
 const large=(await previewAnnualDispatch(plan(6000),s,'2027-05-01')).assignments[0];
 expect(large.durationMinutes).toBeGreaterThan(small.durationMinutes);
 expect((await previewAnnualDispatch(plan(),{...s,machines:[]},'2027-05-01')).assignments).toHaveLength(0);
});
it('generates non-planting work from common rules and blocks duplicate operation keys',async ()=>{
 const s=registeredDemo().state;s.missions=completedSteps(input.pnu,2027,'rice',['plant']);s.fields=[];
 const p=buildAnnualPlan([input],2027,2,{operations:{rice:{harvest:{from:'2027-10-01',to:'2027-10-03'}}}});
 const result=(await previewAnnualDispatch(p,s,'2027-09-01'));expect(result.assignments).toHaveLength(1);
 expect(result.assignments[0].machineId).toContain('CB');
 const a=result.assignments[0];s.missions=[{id:'older-template-id',operationKey:a.operationKey,fieldId:input.pnu,scheduledDate:'2027-10-01',status:'COMPLETED'} as any];
 expect((await previewAnnualDispatch(p,s,'2027-09-01')).assignments).toHaveLength(0);
});
it('generates human work only with an explicit labor productivity rule',async ()=>{
 const s=registeredDemo().state;s.missions=completedSteps(input.pnu,2027,'pepper',['seed','soil']);s.fields=[];
 const p=buildAnnualPlan([{...input,crop:'pepper',mode:'full'}],2027,2,{operations:{pepper:{plant:{from:'2027-05-11',to:'2027-05-12',laborMinutesPer1000m2:30,staff:2,transport:0}}}});
 const a=(await previewAnnualDispatch(p,s,'2027-05-01')).assignments[0];
 expect(a).toMatchObject({machineId:null,owner:'센터 인력',staff:2,durationMinutes:240});
 expect((await previewAnnualDispatch(p,{...s,staffCount:1},'2027-05-01')).assignments).toHaveLength(0);
});
it('does not duplicate unfinished legacy work whose semantic mapping is not confirmed',async ()=>{
 const s=registeredDemo().state;s.missions=[{id:'legacy',fieldId:input.pnu,scheduledDate:'2027-05-25',status:'PLANNED'} as any];
 expect((await previewAnnualDispatch(plan(),s,'2027-05-01')).assignments).toHaveLength(0);
 expect((await previewAnnualDispatch(plan(),s,'2027-05-01')).pending[0].reason).toContain('단계 연결');
});
