import {db} from '../lib/db';
import {createHash} from 'node:crypto';
import type {State} from '../lib/types';
try{
 const result=await db.$transaction(async tx=>{
  const rows=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id='demo' FOR UPDATE`;
  const state=rows[0]?.state;if(!state)throw Error('MISSING_STATE');
  let created=0;
  for(const mission of state.missions){
   const payload={missionId:mission.id,fieldId:mission.fieldId,planVersion:state.planVersion,scheduledDate:mission.scheduledDate??null,plannedStartSlot:mission.start,plannedDurationSlots:mission.duration,resourceId:mission.resourceId,staff:mission.staff,transport:mission.transport,label:mission.label,capturedAt:new Date().toISOString(),source:'CURRENT_STATE_SNAPSHOT',historicalOriginal:false};
   const fingerprint=createHash('sha256').update(JSON.stringify({...payload,capturedAt:null})).digest('hex').slice(0,20);
   const id=mission.id+':'+fingerprint;
   created+=await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','taskPlanSnapshot',${id},1,${JSON.stringify(payload)}::jsonb) ON CONFLICT (workspace,kind,id) DO NOTHING`;
  }
  return {plans:state.missions.length,newSnapshots:created,executionRecordsCreated:0};
 },{timeout:20000});
 console.log(JSON.stringify(result));
}catch{console.log(JSON.stringify({status:'FAILED_NO_EXECUTION_ASSUMED'}));process.exitCode=1}finally{await db.$disconnect()}
