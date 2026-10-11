import {db} from '../lib/db';
import {mappingVersion,type LinkedMission} from '../lib/operation-links';
import type {State} from '../lib/types';
try{
 const rows=await db.$queryRaw<{payload:{before:State}}[]>`SELECT payload FROM "WorkRecord" WHERE workspace='sandbox' AND kind='operationMigration' AND id=${mappingVersion}`;
 const current=await db.center.findUniqueOrThrow({where:{id:'demo'}}),state=current.state as unknown as State,before=rows[0]?.payload.before;
 if(!before)throw Error('복구용 원본 없음');
 for(const old of before.missions){const now=state.missions.find(m=>m.id===old.id);if(!now)throw Error('작업 유실');for(const [k,v] of Object.entries(old))if(JSON.stringify((now as any)[k])!==JSON.stringify(v))throw Error('원본 작업 변경: '+k);}
 const keys=(state.missions as LinkedMission[]).map(m=>m.operationKey);
 if(keys.some(k=>!k)||new Set(keys).size!==460)throw Error('키 누락/중복');
 console.log(JSON.stringify({verified:true,linked:keys.length,originalMissionValuesPreserved:true,backupAvailable:true}));
}finally{await db.$disconnect()}
