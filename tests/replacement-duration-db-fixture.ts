import {db} from '../lib/db';
import {emptyCenter} from '../lib/center-registry';
import {emptyLaborOps,type Worker} from '../lib/labor-operations';
import {recordSpace} from '../lib/workspace';
import {missionReservation} from '../lib/plan-reservation-sync';
import {replacementDurationFixture,replacementDay as day} from './replacement-duration-fixture';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
/** Call after laborCapacityFixture; only changes its snapshotted test records. */
export async function seedReplacementDuration(worker:Worker){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated DB required');
 const {s,m}=replacementDurationFixture(),offer=s.centerSharing!.offers![0];
 const owned=s.machines[0],replacement=s.machines[1];owned.status='AVAILABLE';m.status='PLANNED';
 s.machines=[owned];delete s.centerSharing;
 const lender=emptyCenter('janggye');lender.transportCount=1;lender.staffCount=1;lender.crewCapacity={operators:1,workers:0};lender.machines=[replacement];
 await db.center.update({where:{id:'demo'},data:{state:json(s)}});
 await db.center.update({where:{id:'janggye'},data:{state:json(lender)}});
 await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:'plan:demo:'+m.id,payload:json(missionReservation('demo',m))}});
 await db.workRecord.create({data:{workspace:recordSpace('demo'),kind:'laborDemand',id:m.id,payload:{missionId:m.id,date:day,people:1,status:'UNASSIGNED',source:'COMMON_PLAN'}}});
 await db.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace('demo'),kind:'laborOperations',id:'current'}},data:{payload:json({...emptyLaborOps(),people:[{...worker,workCodes:['general']}]})}});
 const {ownerCenterId:_,...input}=offer;
 return {s,m,offer:{...input,version:0},closed:s.missions[0]};
}
