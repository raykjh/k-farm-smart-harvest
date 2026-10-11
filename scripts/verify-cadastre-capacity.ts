import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {requireProviderArtifact} from '../lib/provider-artifacts';
import {capacityStudySchema,baselineResourcesSchema,contentHash} from '../lib/capacity-study-input';
import {summarizeCapacity} from '../lib/capacity-workload';
import {compareCapacityPlans} from '../lib/capacity-study-scheduling';
import {verifySchedule,type SchedulingContract,type ScheduleResult} from '../lib/scheduling-engine';

// No database or public API access: compute an independently supplied provider sample.
// No neighbor borrowing is asserted without its independently checked topology.
const prepared=requireProviderArtifact('capacityStudy') as {input:unknown;resources:unknown};
const input=capacityStudySchema.parse(prepared.input),baseline=baselineResourcesSchema.parse(prepared.resources);
const summary=summarizeCapacity(input),before=contentHash(baseline);
if(summary.inputHash!==baseline.inputHash)throw Error('Stored sample resource criteria are stale');
const calculate=async(c:SchedulingContract):Promise<ScheduleResult>=>{
 const r=JSON.parse(execFileSync(resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python'),['scripts/capacity-solver-bridge.py'],{input:JSON.stringify(c),encoding:'utf8',maxBuffer:20*1024*1024,timeout:30000,windowsHide:true}));
 if(r.capacityPoolsVersion!=='qualified-pools-v1')throw Error('Qualified capacity pools required');
 if(r.status==='FEASIBLE')verifySchedule(c,r.assignments,r.phase);return r;
};
const comparison=await compareCapacityPlans(input,baseline,{neighbors:{},loans:[],incidents:[]},calculate);
console.log(JSON.stringify({publicParcels:input.population.parcels.length,fictitiousOwners:summary.participation.populationCount,participants:summary.participation.selectedCount,participatingFields:summary.participation.parcels.length,selectedCrops:[...new Set(summary.tasks.map(t=>t.cropId))],byCenter:summary.participation.byCenter,tasks:summary.tasks.length,blockers:summary.blockers,results:comparison.results.map(r=>({id:r.id,status:r.status,assigned:r.assignments.length,optimal:r.optimal,metrics:r.metrics,reason:r.reason})),baselineUnchanged:before===contentHash(baseline),paidCalls:0,dbWrites:0},null,2));
