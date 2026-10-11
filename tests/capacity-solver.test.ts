import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {testPython as python} from './python-runtime';
import {capacityStudySchema,contentHash,distributeScenarioCrops} from '../lib/capacity-study-input';
import {summarizeCapacity} from '../lib/capacity-workload';
import {compareCapacityPlans,validateCapacityChoice} from '../lib/capacity-study-scheduling';
import {verifySchedule,type SchedulingContract,type ScheduleResult} from '../lib/scheduling-engine';
const calculate=async(c:SchedulingContract):Promise<ScheduleResult>=>{
 const result=JSON.parse(execFileSync(python,['scripts/capacity-solver-bridge.py'],{input:JSON.stringify(c),encoding:'utf8',maxBuffer:20*1024*1024,timeout:30000,windowsHide:true}));
 expect(result.capacityPoolsVersion).toBe('qualified-pools-v1');if(result.status==='FEASIBLE')verifySchedule(c,result.assignments,result.phase);return result;
};
const fixture=()=>capacityStudySchema.parse({title:'기준·사건 격리',population:{basis:'SYNTHETIC_OWNER_POPULATION',description:'Synthetic tests only',seed:'test',participationRate:1,owners:[{id:'owner'}],parcels:[{pnu:'0000000000000000001',ownerId:'owner',centerId:'demo',areaM2:1000,cropId:'rice',eligibleCropIds:['rice','pepper'],cropLocked:false,existingBearingOrchard:false,applied:true,year:2026,suitability:'SUITABLE',geographicBasis:'SYNTHETIC_TEST_ONLY',geographicSource:'isolated test'}]},includeConditionalReserve:true,overrides:[]});
it('uses the actual common CP-SAT solver for failure, qualified labor shortage and frozen crop concentration',async()=>{
 const input=fixture(),reference=summarizeCapacity(input),b=reference.baseline;
 b.machines.push({id:'neighbor-RP-001',ownerCenterId:'janggye',capability:'RP',compatibleCrops:['rice']});
 const hash=contentHash(b),baseContext={neighbors:{demo:['janggye']},loans:[{machineId:'neighbor-RP-001',borrowerCenterId:'demo',from:'2026-05-01',to:'2026-06-30',operatorAndTransportConfirmed:true,permission:'ASSUMED_FOR_STUDY' as const,transferSlots:4}],incidents:[]};
 const original=await compareCapacityPlans(input,b,baseContext,calculate);expect(original.results[0].status).toBe('COMPLETE');
 const machine=b.machines.find(m=>m.ownerCenterId==='demo'&&m.capability==='RP')!;
 const failed=await compareCapacityPlans(input,b,{...baseContext,incidents:[{kind:'FAULT',machineId:machine.id,from:'2026-05-01',to:'2026-06-30'}]},calculate);
 expect(failed.results[0].status).toBe('PARTIAL');expect(failed.results[1].status).toBe('COMPLETE');expect(failed.results[1].metrics.borrowedTasks).toBe(1);
 expect(validateCapacityChoice(failed,{alternativeId:'AUTHORIZED_NEIGHBORS',baselineHash:hash}).approvalEligible).toBe(false);
 const absent=await compareCapacityPlans(input,b,{...baseContext,incidents:[{kind:'LABOR_ABSENCE',centerId:'demo',from:'2026-01-01',to:'2026-12-31',workers:100}]},calculate);
 expect(absent.results[0].metrics.requiredUnassigned).toBeGreaterThan(0);
 const pepper=distributeScenarioCrops(input,{pepper:100},'pepper');
 const changed=await compareCapacityPlans(pepper,b,baseContext,calculate);expect(changed.results[0].metrics.requiredUnassigned).toBeGreaterThan(0);
 expect(contentHash(b)).toBe(hash);expect(input.population.parcels[0].cropId).toBe('rice');expect(changed.recommendation.inferenceCalled).toBe(false);
},60000);
