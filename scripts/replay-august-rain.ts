import {db} from '../lib/db';
import {simulateHourlyTask,type HourObservation} from '../lib/work-history';
import type {State} from '../lib/types';
import type {Prisma} from '@prisma/client';
const replay='observed-rain-20260816-v1';
try{const result=await db.$transaction(async tx=>{
 const old=await tx.$queryRaw<{payload:any}[]>`SELECT payload FROM "WorkRecord" WHERE workspace='sandbox' AND kind='historicalReplay' AND id=${replay}`;
 if(old.length)return {alreadyApplied:true,...old[0].payload};
 const rows=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id='demo' FOR UPDATE`;
 const s=rows[0]?.state;if(!s)throw Error();
 const raw=await tx.$queryRaw<{payload:HourObservation}[]>`SELECT payload FROM "WorkRecord" WHERE workspace='shared' AND kind='weatherHourly'`;
 const weather=raw.map(r=>r.payload),selected=s.missions.filter(m=>m.scheduledDate==='2026-08-16'&&m.crop==='고추'&&m.label==='2차 선택 수확');
 if(selected.length!==2||selected.some(m=>s.fields.find(f=>f.id===m.fieldId)?.source!=='DEMO_ASSUMPTION'))throw Error();
 const changes=[];
 for(const m of selected){
 const before=structuredClone(m);
 if(simulateHourlyTask(m,weather,'2026-09-10').status!=='SIMULATED_HELD')throw Error();
 let chosen:any=null;
 for(const day of ['2026-08-17','2026-08-18']){for(let slot=0;slot+m.duration<=32;slot++){
 const trial={...m,scheduledDate:day,start:slot};
 if(simulateHourlyTask(trial,weather,'2026-09-10').status!=='SIMULATED_COMPLETED')continue;
 const farmer=s.fields.find(f=>f.id===m.fieldId)?.farmerId;
 let conflict=false;
 for(let t=slot;t<slot+m.duration;t++){
 const concurrent=s.missions.filter(x=>x.id!==m.id&&x.scheduledDate===day&&((x.start%32+32)%32)<=t&&((x.start%32+32)%32)+x.duration>t);
 if(m.owner==='농부'&&concurrent.some(x=>x.owner==='농부'&&s.fields.find(f=>f.id===x.fieldId)?.farmerId===farmer))conflict=true;
 if(concurrent.reduce((n,x)=>n+(x.owner==='농부'?0:Math.max(1,x.staff)),m.owner==='농부'?0:Math.max(1,m.staff))>s.staffCount)conflict=true;
 }if(!conflict){chosen=trial;break;}
 }if(chosen)break;}
 if(!chosen)throw Error();
 m.originalScheduledDate??=m.scheduledDate;m.scheduledDate=chosen.scheduledDate;m.start=Math.round((Date.parse(m.scheduledDate!)-Date.parse('2026-09-09'))/86400000)*32+chosen.start;
 const execution=simulateHourlyTask(m,weather,'2026-09-10');
 const change={proposalId:replay,before,after:m,source:'DEMO_SIMULATION',reason:'장수 ASOS 248 관측 강수로 예정 시간 수확 보류 후 재배치',simulation:{kind:'OBSERVED_RAIN_REPLAY',from:'2026-08-16',to:'2026-08-16'},approvedAt:new Date().toISOString(),historicalApproval:false};
 const payload={missionId:m.id,label:m.label,plannedDate:m.scheduledDate,originalPlannedDate:before.scheduledDate,actualStartedAt:null,actualFinishedAt:null,...execution,assessment:execution.status,ruleVersion:replay,events:[{date:before.scheduledDate,status:'SIMULATED_HELD'}, {date:m.scheduledDate,status:execution.status}],assumptions:['Historical simulation, not real execution','Blank unflagged rain treated as zero','No field soil recovery observations'],stationId:'248'};
 for(const [kind,p] of [['taskPlanChange',change],['taskExecutionAssessment',payload]] as const)await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox',${kind},${replay+':'+m.id},1,${JSON.stringify(p)}::jsonb)`;
 changes.push({id:m.id,from:before.scheduledDate,to:m.scheduledDate,finished:execution.simulatedFinishedAt});
 }
 s.planVersion++;await tx.center.update({where:{id:'demo'},data:{state:s as unknown as Prisma.InputJsonValue,version:{increment:1}}});
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','historicalReplay',${replay},1,${JSON.stringify({changes})}::jsonb)`;
 return {changes};
 },{timeout:20000});console.log(JSON.stringify(result));}catch{console.log('REPLAY_NOT_APPLIED');process.exitCode=1}finally{await db.$disconnect()}
