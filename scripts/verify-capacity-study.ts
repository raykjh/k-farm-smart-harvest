import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {workloadCrops} from '../lib/crop-workload-catalog';
import {capacityStudySchema,contentHash} from '../lib/capacity-study-input';
import {summarizeCapacity} from '../lib/capacity-workload';
import {compareCapacityPlans} from '../lib/capacity-study-scheduling';
import {verifySchedule,type SchedulingContract,type ScheduleResult} from '../lib/scheduling-engine';

// No DB access. Synthetic parcel numbers are never presented as real cadastre.
const input=capacityStudySchema.parse({title:'30작물 계산기 격리 검증',population:{basis:'SYNTHETIC_OWNER_POPULATION',description:'고유 소유자 100명, 합성 테스트 필지. 실제 지역 규모가 아님.',seed:'capacity-verification',participationRate:0.33,
 owners:Array.from({length:100},(_,i)=>({id:`owner-${i}`})),parcels:Array.from({length:100},(_,i)=>({pnu:String(i+1).padStart(19,'0'),ownerId:`owner-${i}`,centerId:['demo','janggye','cheoncheon','gyenam'][i%4],areaM2:1000,applied:true,cropId:workloadCrops[i%30].id,year:2026,geographicBasis:'SYNTHETIC_TEST_ONLY',geographicSource:'Isolated synthetic test',suitability:'SUITABLE',cropLocked:false,existingBearingOrchard:i%30>=25}))},includeConditionalReserve:true,overrides:[]});
const calculate=async(c:SchedulingContract):Promise<ScheduleResult>=>{
 const raw=execFileSync(resolve('.venv/Scripts/python.exe'),['scripts/capacity-solver-bridge.py'],{input:JSON.stringify(c),encoding:'utf8',maxBuffer:20*1024*1024,timeout:30000,windowsHide:true}),r=JSON.parse(raw);
 if(r.status==='FEASIBLE')verifySchedule(c,r.assignments,r.phase);return r;
};
const full=structuredClone(input);full.population.participationRate=1;full.population.parcels=full.population.parcels.slice(0,30);full.population.owners=full.population.owners.slice(0,30);
const coverage=summarizeCapacity(full),summary=summarizeCapacity(input),before=contentHash(summary.baseline);
const result=await compareCapacityPlans(input,summary.baseline,{neighbors:{},loans:[],incidents:[]},calculate);
const coverageResult=await compareCapacityPlans(full,coverage.baseline,{neighbors:{},loans:[],incidents:[]},calculate);
console.log(JSON.stringify({compiledCropCount:new Set(coverage.tasks.map(t=>t.cropId)).size,all30TaskCount:coverage.tasks.length,
 population:summary.participation.populationCount,participants:summary.participation.selectedCount,taskCount:summary.tasks.length,baselineHash:before,
 results:result.results.map(r=>({id:r.id,status:r.status,optimal:r.optimal,assigned:r.assignments.length,metrics:r.metrics,reason:r.reason})),
 all30Results:coverageResult.results.map(r=>({id:r.id,status:r.status,optimal:r.optimal,assigned:r.assignments.length,requiredUnassigned:r.metrics.requiredUnassigned,reason:r.reason})),baselineUnchanged:contentHash(summary.baseline)===before,paidCalls:0,dbWrites:0},null,2));
