import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {planContinuousProduction,type Participation} from '../lib/continuous-production';
import {appendAssignments} from '../lib/plan-missions';
import {catalogContext,catalogField,catalogState} from './catalog-fixtures';
import * as engine from '../lib/scheduling-engine';
import {calculateCurrentSchedule} from './current-solver';

const field=catalogField('soybean');
const participation:Participation={pnu:field.pnu,consultationId:field.consultationId!,receivedAt:'2033-12-01T00:00:00Z',status:'ACTIVE',term:{from:'2033-12-01',until:null,continuousConsent:true},changedAt:'2033-12-01T00:00:00Z',reason:'격리 검증용 연속 관리 동의'};
const criteria=(year:number)=>({profiles:[{id:'crop-season',name:'격리 검증용 작기',context:catalogContext(year),dataOrigin:'DEMO' as const,sourceBatchId:'isolated-crop30-test'}]});
const initial=()=>({fields:[field],participations:[participation],cycles:[],state:catalogState(),criteria:criteria(2034),version:1,today:'2033-12-31',names:{},consentedPnus:[field.pnu]});
let completed:ReturnType<typeof appendAssignments>;
let cycle:NonNullable<Awaited<ReturnType<typeof planContinuousProduction>>['items'][number]['proposal']>['cultivation'];
let solver:ReturnType<typeof vi.spyOn>;
beforeAll(async()=>{
 solver=vi.spyOn(engine,'solveSchedule').mockImplementation(calculateCurrentSchedule);
 const input=initial(),proposal=(await planContinuousProduction(input)).items[0].proposal!;
 expect(proposal).toBeTruthy();cycle=proposal.cultivation;
 completed=appendAssignments(input.state,proposal.plan,proposal.dispatch);
 completed.missions.forEach(m=>m.status='COMPLETED');
},30000);
afterAll(()=>solver.mockRestore());
const nextInput=()=>({...initial(),state:structuredClone(completed),cycles:[cycle],criteria:criteria(2035),today:'2034-12-31'});
const cancellation=()=>({requestId:randomUUID(),category:'UNNECESSARY' as const,reason:'별도 예찰로 대체하여 이 작업 생략',confirmedAt:'2034-07-01T09:00:00+09:00',confirmedBy:'isolated-operator'});

it('continues after an explicitly omitted inspection without rewriting previous work or linking it as a prerequisite',async()=>{
 const input=nextInput(),scout=input.state.missions.find(m=>m.id.endsWith(':scout'))!;
 scout.status='CANCELLED';scout.cancellation=cancellation();const before=structuredClone(input.state);
 const view=await planContinuousProduction(input),item=view.items[0];
 expect(item.status,item.reason+' '+JSON.stringify(item.comparisons)).toBe('REVIEW');
 expect(item.proposal!.cultivation.previousId).toBe(cycle.id);
 expect(item.proposal!.plan.plots[0].tasks.flatMap(t=>t.predecessorKeys)).not.toContain(scout.id);
 expect(input.state).toEqual(before);expect(scout.status).toBe('CANCELLED');expect(view.inferenceCalled).toBe(false);
});

it.each(['required','withdrawal','crop-change','missing-reason','missing-actor','missing-kind','missing-record','held','planned','unstaffed'] as const)('does not treat %s as a completed previous cultivation',async condition=>{
 const input=nextInput(),task=input.state.missions.find(m=>m.id.endsWith(condition==='required'?':harvest':':scout'))!;
 task.status='CANCELLED';task.cancellation=cancellation();
 if(condition==='withdrawal')task.cancellation.category='WITHDRAWAL';
 if(condition==='crop-change')task.cancellation.category='CROP_CHANGE';
 if(condition==='missing-reason')task.cancellation.reason='';
 if(condition==='missing-actor')task.cancellation.confirmedBy='';
 if(condition==='missing-kind')delete (task as typeof task&{kind?:string}).kind;
 if(condition==='missing-record')delete task.cancellation;
 if(condition==='held')task.status='HELD';
 if(condition==='planned')task.status='PLANNED';
 if(condition==='unstaffed')task.status='UNSTAFFED';
 const before=structuredClone(input.state),view=await planContinuousProduction(input);
 expect(view.items[0].status).toBe('BLOCKED');expect(view.items[0].proposal).toBeNull();expect(input.state).toEqual(before);
});
