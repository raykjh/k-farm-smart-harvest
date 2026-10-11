import {db} from '../lib/db';
import {simulateHourlyTask,type HourObservation} from '../lib/work-history';
import type {State} from '../lib/types';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
try{
 const counts:Record<string,number>={};
 await db.$transaction(async tx=>{
 const centers=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id='demo' FOR UPDATE`;
 const s=centers[0]?.state;if(!s)throw Error();
 const obs=await tx.$queryRaw<{payload:HourObservation}[]>`SELECT payload FROM "WorkRecord" WHERE workspace='shared' AND kind='weatherHourly'`;
 if(!obs.length)throw Error();
 for(const m of s.missions){if(!m.scheduledDate||m.scheduledDate>=today||s.fields.find(f=>f.id===m.fieldId)?.source!=='DEMO_ASSUMPTION')continue;
 const weather=obs.map(r=>r.payload).filter(r=>r.observedAt.startsWith(m.scheduledDate!));
 const result=simulateHourlyTask(m,weather,today);
 const payload={missionId:m.id,label:m.label,plannedDate:m.scheduledDate,originalPlannedDate:m.originalScheduledDate??null,actualStartedAt:null,actualFinishedAt:null,assessment:result.status,...result,ruleVersion:'hourly-demo-v2',assumptions:['Blank precipitation on present unflagged rows is treated as zero for demo calculation only','Positive hourly rain holds all outdoor work for this conservative demo','Resource and field readiness assumed, not real execution proof'],stationId:'248'};
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','taskExecutionAssessment',${m.id+':hourly-demo-v2'},1,${JSON.stringify(payload)}::jsonb) ON CONFLICT (workspace,kind,id) DO UPDATE SET payload=EXCLUDED.payload,"updatedAt"=CURRENT_TIMESTAMP,version="WorkRecord".version+1`;
 counts[result.status]=(counts[result.status]??0)+1;
 }
 },{timeout:20000});console.log(JSON.stringify(counts));
}catch{console.log('EXECUTION_GENERATION_FAILED');process.exitCode=1}finally{await db.$disconnect()}
