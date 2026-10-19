import {db} from './db';
import {recordSpace} from './workspace';
import {centerRegistry} from './center-registry';
import {advanceAttendance,emptyLaborOps,type LaborOps,attendanceDates} from './labor-operations';
import {currentLaborDemands} from './labor-demands';
import {laborSharingLock,externalLaborBusy,reconcileLaborShares,sharedLaborRows,type LaborShare} from './labor-sharing';
import {assertCapacityRoster} from './labor-capacity-store';
import {refreshLaborRecoveries} from './labor-recovery-store';
import {laborPoliciesForDates} from './labor-policy-store';
import {prepareRecruitment} from './labor-recruitment';
import {prepareSms} from './sms-store';

/** Committed ordinary-labor demands use the center's common wage basis.
 * The tick records proposals, never invented responses, worked time or payment. */
export async function refreshCenterAttendance(centerId:string,now=new Date().toISOString()){
 const key={workspace:recordSpace(centerId),kind:'laborOperations',id:'current'},row=await db.workRecord.findUnique({where:{workspace_kind_id:key}});
 const today=new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
 const due=(s:LaborOps)=>s.jobs.some(j=>j.status==='OPEN'&&j.attendance&&today>=attendanceDates(j).allocateOn&&today<=j.date);
 const pending=await currentLaborDemands(db,centerId),prior=(row?.payload??emptyLaborOps()) as unknown as LaborOps;
 const soon=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 if(!due(prior)&&!pending.some(d=>d.date>=today&&d.date<=soon&&!d.held&&!d.completed&&!prior.jobs.some(j=>j.missionId===d.missionId&&j.status!=='STALE')))return false;
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${centerId} FOR UPDATE`;
  await laborSharingLock(tx);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labor-operations:${recordSpace(centerId)}`}))`;
  const current=await tx.workRecord.findUnique({where:{workspace_kind_id:key}}),s=(current?.payload??emptyLaborOps()) as unknown as LaborOps,before=JSON.stringify(s);
  const demands=await currentLaborDemands(tx,centerId),shares=(await sharedLaborRows(tx)).map(r=>r.payload as unknown as LaborShare).filter(o=>o.borrowerCenterId===centerId&&o.status==='ASSIGNED');
  const policies=await laborPoliciesForDates(tx,centerId,demands.map(d=>d.date));
  s.reserveCapacityByYear=Object.fromEntries(Object.entries(policies).map(([year,p])=>[year,p.policy?.reserveCount??3]));
  prepareRecruitment(s,demands.filter(d=>d.date<=soon),policies,now);
  s.externalBusy=await externalLaborBusy(tx,centerId);
  for(const j of [...s.jobs].sort((a,b)=>a.date.localeCompare(b.date)||a.startMinute-b.startMinute||a.id.localeCompare(b.id))){
   if(!demands.some(d=>d.id===j.missionId&&d.sourceHash===j.sourceHash&&!d.held&&!d.completed))continue;
   j.borrowedNames=shares.filter(o=>o.jobId===j.id&&o.sourceHash===j.sourceHash).map(o=>o.workerName);
   advanceAttendance(s,j,now);
  }
  delete s.externalBusy;for(const j of s.jobs)delete j.borrowedNames;
  if(JSON.stringify(s)===before)return false;
  await assertCapacityRoster(tx,centerId,s);
  await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,version:1,payload:JSON.parse(JSON.stringify(s))},update:{version:{increment:1},payload:JSON.parse(JSON.stringify(s))}});
  await reconcileLaborShares(tx);
  await refreshLaborRecoveries(tx,centerId);
  await prepareSms(tx,centerId,now);
  await tx.audit.create({data:{centerId,action:'labor.attendance.auto',detail:{at:now,policy:'SEVEN_TWO',version:(current?.version??0)+1}}});
  return true;
 },{timeout:20000});
}
export async function refreshAllAttendance(){for(const c of centerRegistry)await refreshCenterAttendance(c.id);}
