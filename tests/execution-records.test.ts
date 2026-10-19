import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {saveExecution,saveReportSnapshot,readReport,reportHash,snapshotInput} from '../lib/execution-records';
it('accepts unified report scope without changing legacy report scopes',()=>{
 const b={id:randomUUID(),actor:'test',source:'ALL',period:'2026',expectedHash:'a'.repeat(64)};
 expect(snapshotInput.parse(b).source).toBe('ALL');
 expect(snapshotInput.parse({...b,source:'SIMULATED'}).source).toBe('SIMULATED');
 expect(snapshotInput.parse({...b,source:'ACTUAL'}).source).toBe('ACTUAL');
});
it('freezes all registered report rows together and retains their original provenance',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated test DB required');
 const original=await db.center.findUnique({where:{id:'demo'}}),prefix=randomUUID(),snapshotId=randomUUID(),legacyId=randomUUID();
 const fields=[{id:prefix+'a',source:'REGISTERED'},{id:prefix+'b',source:'DEMO_ASSUMPTION'}];
 const state={name:'test',planVersion:1,fields,missions:fields.map(f=>({id:f.id,fieldId:f.id,status:'PLANNED',scheduledDate:'2026-01-01',duration:4,staff:1,crop:'쌀',label:'수확'})),machines:[],revisions:[],events:[]};
 try{
  await db.center.upsert({where:{id:'demo'},create:{id:'demo',state},update:{state}});
  const report=await db.$transaction(readReport),input={id:snapshotId,actor:'test',source:'ALL',period:'2026',expectedHash:reportHash(report)};
  const result=await saveReportSnapshot(input) as {content:Awaited<ReturnType<typeof readReport>>};expect(result.content.rows.filter(r=>r.missionId.startsWith(prefix))).toHaveLength(2);
  expect(new Set(result.content.rows.filter(r=>r.missionId.startsWith(prefix)).map(r=>r.source))).toEqual(new Set(['ACTUAL','SIMULATED']));
  expect(await saveReportSnapshot(input)).toEqual(result);
  const legacy=await saveReportSnapshot({...input,id:legacyId,source:'ACTUAL'}) as {content:Awaited<ReturnType<typeof readReport>>};expect(legacy.content.rows.filter(r=>r.missionId.startsWith(prefix))).toHaveLength(1);
  expect(await db.$transaction(readReport)).toEqual(report);
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'reports',kind:'confirmedReport',id:snapshotId}}})).payload).toEqual(result);
 }finally{
  await db.workRecord.deleteMany({where:{workspace:'reports',kind:'confirmedReport',id:{in:[snapshotId,legacyId]}}});
  if(original)await db.center.update({where:{id:'demo'},data:{state:original.state!,version:original.version}});else await db.center.delete({where:{id:'demo'}});
 }
});
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
