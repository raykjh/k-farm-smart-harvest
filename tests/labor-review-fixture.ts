import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {smsInput,json,offset} from './sms-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {newAttendance} from '../lib/labor-operations';
import {currentLaborDemands} from '../lib/labor-demands';
import {refreshCenterAttendance} from '../lib/labor-attendance-store';
export const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export async function laborReviewFixture(daysAhead=3){
 const base=await laborCapacityFixture();
 try{
  const f=smsInput(offset(today(),daysAhead));f.s.fields=f.s.fields.slice(0,1);f.s.missions=f.s.missions.slice(0,1);f.s.missions[0].duration=16;
  f.labor.people.push({...f.labor.people[1],id:randomUUID(),name:'홍대체',phone:'010-0000-0003'});f.labor.people.forEach((p,i)=>p.phone='010-0000-000'+i);
  const j=f.labor.jobs[0];j.invited=[];j.attendance=newAttendance();f.labor.notices=[];
  await db.center.update({where:{id:'demo'},data:{state:json(f.s)}});
  await db.workRecord.create({data:{workspace:'sandbox',kind:'laborDemand',id:j.missionId,payload:{missionId:j.missionId}}});
  const [d]=await currentLaborDemands(db,'demo');Object.assign(j,{...d,id:j.id,distances:Object.fromEntries(f.labor.people.map((p,i)=>[p.id,i+1]))});
  await db.workRecord.update({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}},data:{payload:json(f.labor)}});
  await refreshCenterAttendance('demo');
  return {...f,cleanup:base.cleanup,async read(){return db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}})}};
 }catch(e){await base.cleanup();throw e}
}
