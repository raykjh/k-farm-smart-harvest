import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {saveExecution,saveReportSnapshot,readReport,reportHash} from '../lib/execution-records';
it('preserves corrections, rejects stale writes, freezes snapshots and separates demo',async()=>{
 const original=await db.center.findUnique({where:{id:'demo'}}),ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()];
 const state={name:'test',planVersion:1,fields:[{id:ids[0],source:'REGISTERED'}],missions:[{id:ids[0],fieldId:ids[0],status:'PLANNED',scheduledDate:'2026-01-01',duration:4,staff:1,crop:'쌀',label:'test'}],machines:[],revisions:[],events:[]};
 try{
 await db.center.upsert({where:{id:'demo'},create:{id:'demo',state},update:{state}});
 const b={id:ids[1],missionId:ids[0],expectedPlanVersion:1,expectedEvidenceId:null,status:'COMPLETED',startedAt:'2026-01-01T09:00:00+09:00',finishedAt:'2026-01-01T10:00:00+09:00',actor:'test',reason:'completion'};
 await saveExecution(b);await saveExecution(b);
 expect(await db.workRecord.count({where:{id:ids[1]}})).toBe(1);
 let report=await db.$transaction(readReport);expect(report.rows[0]).toMatchObject({confirmed:true,source:'ACTUAL',executionMinutes:60});
 const snapInput={id:ids[2],actor:'test',source:'ACTUAL',period:'2026',expectedHash:reportHash(report)};
 const snap=await saveReportSnapshot(snapInput);await saveReportSnapshot(snapInput);
 await expect(saveExecution({...b,id:ids[3]})).rejects.toThrow('변경');
 await saveExecution({...b,id:ids[3],expectedPlanVersion:2,expectedEvidenceId:ids[1],status:'HELD',startedAt:null,finishedAt:null,reason:'incorrect completion'});
 report=await db.$transaction(readReport);expect(report.rows[0]).toMatchObject({confirmed:false,status:'HELD',overdue:true});
 expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'reports',kind:'confirmedReport',id:ids[2]}}})).payload).toEqual(snap);
 await expect(saveReportSnapshot({...snapInput,id:ids[4]})).rejects.toThrow('변경');
 expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'taskExecutionAssessment',id:ids[3]}}})).payload).toMatchObject({supersedesId:ids[1]});
 state.fields[0].source='DEMO_ASSUMPTION';state.planVersion=4;await db.center.update({where:{id:'demo'},data:{state}});
 await saveExecution({...b,id:ids[4],expectedPlanVersion:4,expectedEvidenceId:ids[3]});
 expect((await db.$transaction(readReport)).rows[0]).toMatchObject({source:'SIMULATED',confirmed:true});
 }finally{
 await db.workRecord.deleteMany({where:{id:{in:ids}}});
 await db.audit.deleteMany({where:{action:'EXECUTION_CONFIRMED',detail:{path:['missionId'],equals:ids[0]}}});
 if(original)await db.center.update({where:{id:'demo'},data:{state:original.state!,version:original.version}});else await db.center.delete({where:{id:'demo'}});
 }
});
