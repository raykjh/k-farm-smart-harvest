import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {db} from '../lib/db';
import type {State} from '../lib/types';
import type {ExecutionView} from '../lib/execution-view';
import {demoCompletionBatch} from '../lib/demo-history-completion';
const arg=(name:string)=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
const before=arg('--before'),centerId=arg('--center'),apply=process.argv.includes('--apply');
const url=new URL(process.env.DATABASE_URL??'');
assert(url.hostname==='127.0.0.1'&&url.port==='55432'&&url.pathname==='/kfarm','Explicit local operating database only');
assert(centerId==='demo'&&before,'Explicit --center=demo and --before required');
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
assert(before<=today,'No future history');
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
try{
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${centerId} FOR UPDATE`;
  const center=await tx.center.findUniqueOrThrow({where:{id:centerId}});
  const evidence=await tx.workRecord.findMany({where:{workspace:'sandbox',kind:'taskExecutionAssessment'},orderBy:[{updatedAt:'desc'},{id:'asc'}]});
  const batch=demoCompletionBatch(center.state as unknown as State,evidence.map(r=>({...r.payload as ExecutionView,recordId:r.id})),before,new Date().toISOString());
  const summary={applied:apply,centerId,before,newSimulationCompletions:batch.records.length,skipped:batch.skipped,actualCompletionsCreated:0};
  if(!apply||!batch.records.length)return summary;
  // A private, exclusive-create backup is written before the first DB mutation.
  const backup=resolve('.data/backups','demo-history-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
  await mkdir(resolve('.data/backups'),{recursive:true});
  const snapshot={center,evidence,insertedIds:batch.records.map(r=>r.id)};
  await writeFile(backup,JSON.stringify({format:'DEMO_HISTORY_PATCH_BACKUP_V1',sha256:hash(snapshot),snapshot}),{flag:'wx',mode:0o600});
  await tx.workRecord.createMany({data:batch.records.map(r=>({workspace:'sandbox',kind:'taskExecutionAssessment',id:r.id,payload:JSON.parse(JSON.stringify(r.payload))}))});
  await tx.center.update({where:{id:centerId},data:{state:JSON.parse(JSON.stringify(batch.state)),version:{increment:1}}});
  await tx.audit.create({data:{centerId,action:'DEMO_HISTORY_NORMAL_COMPLETION',detail:{...summary,backup,recordIds:batch.records.map(r=>r.id),previousVersion:center.version}}});
  return {...summary,backup};
 },{timeout:30000});
 console.log(JSON.stringify(result));
}finally{await db.$disconnect()}
