import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {emptyLaborOps,respond,allocateJob,overrideJob,rankedWorkers,type Worker,type LaborJob} from '../lib/labor-operations';
import {laborCapacityBlocks} from '../lib/labor-capacity';
import {emptyCenter} from '../lib/center-registry';
const day='2032-09-01';
const person=(reserve=false):Worker=>({id:randomUUID(),name:'홍검증',birth:'1960-01-01',phone:'000',address:'가상',registeredFarmer:false,usesApp:false,active:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['harvest'],employment:reserve?'CENTER_RESERVE':'VOLUNTEER',standbyDates:reserve?[day]:[]});
const job=():LaborJob=>({id:randomUUID(),missionId:'m',task:'수확',address:'가상',date:day,startMinute:540,durationMinutes:60,count:1,workCode:'harvest',sourceHash:'hash',pay:'별도',status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[]});
it('keeps employees in reserve, then prioritizes a confirmed shift over volunteer waitlists on absence without penalties',()=>{
 const s=emptyLaborOps(),a=person(),waiting=person(),reserve=person(true),j=job();s.people=[a,waiting,reserve];s.jobs=[j];j.invited=[a.id,waiting.id];j.responses={[a.id]:'PHONE',[waiting.id]:'APP'};j.distances={[a.id]:0,[waiting.id]:1};allocateJob(s,j,'2026-10-03');
 expect(j.assigned).toEqual([a.id]);expect(rankedWorkers(s,j).some(p=>p.id===reserve.id)).toBe(false);
 respond(s,j.id,a.id,'DECLINED','2026-10-03');expect(j.assigned).toEqual([reserve.id]);expect(j.responses[reserve.id]).toBe('STANDBY');expect(s.penalties).toEqual([]);
 expect(s.notices.filter(n=>n.workerId===reserve.id).map(n=>n.type)).toEqual(['ASSIGNED']);
});
it('never uses unconfirmed, unavailable, unqualified, already busy reserve employees or overrides a manual list',()=>{
 for(const variant of ['undated','excluded','wrong-work','busy','manual']){
  const s=emptyLaborOps(),a=person(),r=person(true),j=job();s.people=[a,r];s.jobs=[j];j.invited=[a.id];j.responses[a.id]='PHONE';j.assigned=[a.id];
  if(variant==='undated')r.standbyDates=[];if(variant==='excluded')r.excludedDates=[day];if(variant==='wrong-work')r.workCodes=['weed'];
  if(variant==='busy')s.jobs.push({...job(),assigned:[r.id]});if(variant==='manual')j.manual=[a.id];
  respond(s,j.id,a.id,'DECLINED','2026-10-03');expect(j.assigned,variant).toEqual([]);expect(s.penalties).toEqual([]);
  if(variant==='manual'){overrideJob(s,j.id,null,'2026-10-03');expect(j.assigned).toEqual([r.id]);expect(j.responses[r.id]).toBe('STANDBY');}
 }
});
it('unions two absence intervals of the same person without double reducing capacity',()=>{
 const s=emptyCenter('demo');s.crewCapacity={operators:0,workers:2};s.laborCapacity={incoming:[],outgoing:[],absences:[{workerId:'p',date:day,startMinute:540,endMinute:600},{workerId:'p',date:day,startMinute:570,endMinute:630}]};
 const blocks=laborCapacityBlocks(s)!;expect(blocks).toHaveLength(1);expect(blocks[0].duration).toBe(6);expect(blocks[0].staff).toBe(1);
});
