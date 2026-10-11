import {it,expect,vi} from 'vitest';
vi.mock('../lib/field-conditions',()=>({recommendConditions:()=>[{crop:'rice',score:95,blocked:[],missing:[]},{crop:'potato',score:70,blocked:[],missing:[]}]}));
vi.mock('../lib/annual-dispatch',()=>({previewAnnualDispatch:(plan:any)=>({assignments:[{taskId:plan.plots[0].tasks[0].id,pnu:plan.plots[0].pnu,date:'2027-05-01',startMinute:480,durationMinutes:30,staff:1,transport:0,owner:'센터 인력',machineId:null}],pending:[],feasibility:[{pnu:plan.plots[0].pnu,status:plan.plots[0].crop==='potato'?'CAPACITY_FEASIBLE':'INCOMPLETE',missing:plan.plots[0].crop==='potato'?[]:[{taskId:'harvest',name:'수확',reason:'테스트 자원 부족'}]}]})}));
vi.mock('../lib/planning-fields',()=>({connectPlanningFields:(_p:any,s:any)=>s}));
// Stub append's input plan to isolate ranking, while keeping the production selection loop.
vi.mock('../lib/annual-plan',()=>({buildAnnualPlan:(fields:any[],_year:number,_version:number,_context:any,cultivation:any)=>({plots:[{pnu:fields[0].pnu,crop:fields[0].crop,area:1000,tasks:[{id:'task',name:'test',predecessorKeys:[],requirements:{},window:{to:'2027-05-10'}}]}]})}));
import {delegatedProposal} from '../lib/delegated-planning';
it('prefers complete lower-scoring crop over incomplete higher-scoring crop',async ()=>{
 const field={pnu:'5274036023110930001',address:'test',area:1000,mode:'full',consultationId:'farmer',conditions:{region:'계북면',machineAccess:'yes'}} as any;
 const state={fields:[{id:field.pnu}],missions:[],machines:[],staffCount:2,transportCount:2} as any;
 const result=(await delegatedProposal([field],1,state,[],{start:'2027-01-01',end:'2027-12-31',context:{region:'계북면'}},()=> '20000000-0000-4000-8000-000000000001','2026-09-20'));
 expect(result.plans[0].cultivation.crop).toBe('potato');expect(result.comparisons).toHaveLength(2);expect(result.comparisons.filter(x=>x.selected).map(x=>x.crop)).toEqual(['potato']);expect(state.missions).toHaveLength(0);
});
