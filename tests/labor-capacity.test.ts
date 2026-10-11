import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {emptyCenter} from '../lib/center-registry';
import {dateSlot,solveSchedule,verifySchedule,type SchedulingContract,type SchedulingJob} from '../lib/scheduling-engine';
import {laborCapacityInput,withLaborSupport,laborCapacityBlocks,type LaborCapacityWindow} from '../lib/labor-capacity';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {appendAssignments} from '../lib/delegated-planning';
import {calculateAnnualReplan} from '../lib/annual-replanning';
import type {AnnualPlan} from '../lib/annual-plan';
import type {State} from '../lib/types';
import {compareCropAlternatives} from '../lib/crop-decision';
const date='2032-09-01',start=dateSlot(date)+2;
export const supportWindow=(status:LaborCapacityWindow['status']='CONFIRMED'):LaborCapacityWindow=>({id:randomUUID(),ownerCenterId:'demo',borrowerCenterId:'janggye',workerId:randomUUID(),workerName:'홍가상',date,startMinute:480,endMinute:600,travelMinutes:30,workCodes:['harvest'],response:'PHONE',consent:true,reason:'격리 검증',status,actor:'test',createdAt:'2026-10-03T00:00:00Z'});
const job=():SchedulingJob=>({id:'harvest',original:start,allowed:[start],duration:4,selected:true,optional:true,resource:null,field:'p',person:null,staff:1,transport:0,capacityDemands:{'janggye:workers':1,'janggye:operators':0},preferred:null,predecessor:null});
const mission={owner:'센터 인력' as const,resourceId:null,staff:1,ordinaryWorkers:1,operationCode:'harvest'};
const state=(w:LaborCapacityWindow):State=>({...emptyCenter('janggye'),crewCapacity:{operators:0,workers:0},laborCapacity:{incoming:[w],outgoing:[]}});
const contract=(tasks:SchedulingJob[]):SchedulingContract=>({tasks,purpose:'INITIAL',daily:false,freezeBefore:0,staffCapacity:0,transportCapacity:0,capacityLimits:{'janggye:workers':0,'janggye:operators':0}});

it('checks work type, consent status and travel on both sides of the work window',()=>{
 const w=supportWindow(),s=state(w);
 expect(withLaborSupport(s,job(),mission).options![0].laborCandidates![0].allowed).toEqual([start]);
 for(const patch of [{status:'OFFERED' as const},{travelMinutes:45},{workCodes:['soil']}])expect(withLaborSupport(state({...w,...patch}),job(),mission).options![0].laborCandidates).toEqual([]);
 expect(()=>laborCapacityInput.parse({...w,id:undefined})).toThrow();
 s.laborCapacity={incoming:[],outgoing:[w]};s.crewCapacity!.workers=1;s.staffCount=1;
 expect(laborCapacityBlocks(s)).toEqual([{start:dateSlot(date),duration:8,staff:1,capacityDemands:{'janggye:workers':1}}]);
});

it('independently rejects forged support, duplicate people and replacement of qualified operators',()=>{
 const w=supportWindow(),j=withLaborSupport(state(w),job(),mission),c=contract([j]);
 expect(()=>verifySchedule(c,[{id:j.id,start,laborSupportIds:[w.id]}],'INITIAL_DISPATCH')).not.toThrow();
 expect(()=>verifySchedule(c,[{id:j.id,start,laborSupportIds:['forged']}],'INITIAL_DISPATCH')).toThrow('지원');
 expect(()=>verifySchedule(contract([j,{...j,id:'second',field:'other'}]),[{id:j.id,start,laborSupportIds:[w.id]},{id:'second',start,laborSupportIds:[w.id]}],'INITIAL_DISPATCH')).toThrow('중복');
 expect(()=>verifySchedule(contract([{...j,ordinaryWorkerCount:0}]),[{id:j.id,start,laborSupportIds:[w.id]}],'INITIAL_DISPATCH')).toThrow('지원');
});

it('respects the same confirmed support in real solver calls for initial and replan contracts',async()=>{
 const w=supportWindow(),c=contract([withLaborSupport(state(w),job(),mission)]);
 for(const purpose of ['INITIAL','REPLAN'] as const){const result=await solveSchedule({...c,purpose});expect(result.status).toBe('FEASIBLE');if(result.status==='FEASIBLE')expect(result.assignments[0].laborSupportIds).toEqual([w.id]);}
 const noSupport=await solveSchedule(contract([withLaborSupport(state({...w,status:'OFFERED'}),job(),mission)]));
 expect(noSupport.status==='FEASIBLE'&&noSupport.assignments.length).toBe(0);
});

it('persists support identity through initial dispatch and carries it into the common replan engine',async()=>{
 const w=supportWindow(),s=state(w);
 // Only fixture inputs: the real initial adapter, plan append and replan engine run.
 const plan={year:2032,plots:[{pnu:'5274036023110930000',area:1000,crop:'pepper',mode:'full',consultationId:'fixture-farmer',address:'격리 테스트 필지',tasks:[{id:'fixture-harvest',name:'고추 수확',operationCode:'harvest',operationKey:'fixture:harvest',predecessorKeys:[],kind:'PROCESS',window:{from:date,to:date},requirements:{owner:'센터 인력',staff:1,transport:0,machineCode:null,laborMinutesPer1000m2:60,setupMinutes:0,requiresOperator:false,rainSensitive:false}}]}]} as unknown as AnnualPlan;
 const dispatched=await previewAnnualDispatch(plan,s,'2032-08-31');
 const compared=await compareCropAlternatives([{id:'crop',plan}],s,'2032-08-31',[{id:'local',candidateId:'crop',resourceScope:'LOCAL_ONLY'},{id:'shared',candidateId:'crop',resourceScope:'CONFIRMED_SHARED'}]);
 expect(compared.results[0].status).toBe('INCOMPLETE');expect(compared.results[1].status).toBe('CAPACITY_FEASIBLE');expect(compared.results[1].metrics.sharedWorkerMinutes).toBe(60);
 expect(dispatched.assignments).toHaveLength(1);expect(dispatched.assignments[0].laborSupportIds).toEqual([w.id]);
 const stored=appendAssignments(s,plan,dispatched);expect(stored.missions[0].laborSupportIds).toEqual([w.id]);
 const replanned=await calculateAnnualReplan(stored,{ids:['fixture-harvest'],scope:'PRESERVE'}, {status:'NOT_CONFIGURED',points:[]} as any,'2032-08-31');
 expect(replanned.status).toBe('FEASIBLE');expect(replanned.assignments[0].laborSupportIds).toEqual([w.id]);
});
