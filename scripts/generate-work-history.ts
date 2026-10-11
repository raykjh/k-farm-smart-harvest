import {db} from '../lib/db';
import {assessHistoricalTask,type DailyObservation} from '../lib/work-history';
import type {State} from '../lib/types';
import {createHash} from 'node:crypto';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
try{
 const counts:Record<string,number>={};
 await db.$transaction(async tx=>{
 const centers=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id='demo' FOR UPDATE`;
 const state=centers[0]?.state;if(!state)throw Error();
 const observations=await tx.$queryRaw<{id:string;version:number;payload:DailyObservation}[]>`SELECT id,version,payload FROM "WorkRecord" WHERE workspace='shared' AND kind='weatherObservation'`;
 const byDate=new Map(observations.map(r=>[r.payload.date,r]));
 for(const m of state.missions){
  if(!m.scheduledDate||m.scheduledDate>=today||state.fields.find(f=>f.id===m.fieldId)?.source!=='DEMO_ASSUMPTION')continue;
  const weather=byDate.get(m.scheduledDate),assessment=assessHistoricalTask(m,weather?.payload,today);
  const payload={missionId:m.id,source:'DEMO_SIMULATION',ruleVersion:'daily-screen-v1',plannedDate:m.scheduledDate,originalPlannedDate:m.originalScheduledDate??null,actualStartedAt:null,actualFinishedAt:null,actualQuantity:null,executionStatus:'UNCONFIRMED',assessment:assessment.status,reason:assessment.reason,observationId:weather?.id??null,observationVersion:weather?.version??null,observation:weather?.payload??null,legacyStatus:m.status,legacyStatusIsEvidence:false};
  const id=m.id+':'+createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0,20);
  await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','taskExecutionAssessment',${id},1,${JSON.stringify(payload)}::jsonb) ON CONFLICT (workspace,kind,id) DO NOTHING`;
  counts[assessment.status]=(counts[assessment.status]??0)+1;
 }
 },{timeout:20000});
 console.log(JSON.stringify({assessments:counts,actualCompletionsInvented:0}));
}catch{console.log('HISTORY_FAILED');process.exitCode=1}finally{await db.$disconnect()}
