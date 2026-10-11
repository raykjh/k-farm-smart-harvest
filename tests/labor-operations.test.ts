import {it,expect} from 'vitest';
import {emptyLaborOps,availableFor,allocateJob,respond,overrideJob,completeJob,addPenalty,laborScore,type Worker,type LaborJob} from '../lib/labor-operations';
const now='2026-09-18T12:00:00Z';
const person=(id:string):Worker=>({id,name:id,birth:'1960-01-01',phone:'000',address:'test',registeredFarmer:false,usesApp:false,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:1020,workCodes:['*'],active:true});
const job=(id='j'):LaborJob=>({id,missionId:id,task:'test',address:'test',date:'2026-09-18',startMinute:540,durationMinutes:60,count:1,workCode:'seed',sourceHash:'test',pay:'test',status:'OPEN',invited:['a','b'],responses:{},distances:{a:5,b:1},assigned:[],manual:null,worked:[]});
const setup=()=>({...emptyLaborOps(),people:[person('a'),person('b')],jobs:[job()]});
it('requires work/time/date eligibility and attendance before automatic ranking',()=>{
 const s=setup(),j=s.jobs[0];allocateJob(s,j,now);expect(j.assigned).toEqual([]);respond(s,'j','a','PHONE',now);expect(j.assigned).toEqual(['a']);respond(s,'j','b','APP',now);expect(j.assigned).toEqual(['b']);expect(s.notices.some(n=>n.workerId==='a'&&n.type==='CANCELLED')).toBe(true);
 expect(availableFor({...person('b'),excludedDates:[j.date]},j)).toBe(false);expect(availableFor({...person('b'),endMinute:550},j)).toBe(false);expect(availableFor({...person('b'),workCodes:['harvest']},j)).toBe(false);
});
it('uses score before distance and handles unknown distance and exact ties deterministically',()=>{
 const s=setup(),j=s.jobs[0];j.responses={a:'APP',b:'PHONE'};s.penalties.push({id:'p',jobId:'old',workerId:'b',points:5,reason:'test',operator:'test',at:now});allocateJob(s,j,now);expect(j.assigned).toEqual(['a']);s.penalties=[];j.distances={a:null,b:3};allocateJob(s,j,now);expect(j.assigned).toEqual(['b']);j.distances={};allocateJob(s,j,now);expect(j.assigned).toEqual(['a']);
});
it('prevents concurrent double booking, honors override and cancels withdrawn participants',()=>{
 const s=setup(),j=s.jobs[0];j.responses={a:'APP',b:'PHONE'};s.jobs.push({...job('other'),assigned:['b']});allocateJob(s,j,now);expect(j.assigned).toEqual(['a']);expect(()=>overrideJob(s,'j',['b'],now)).toThrow();
 s.jobs[1].assigned=[];overrideJob(s,'j',['a'],now);respond(s,'j','b','APP',now);expect(j.assigned).toEqual(['a']);overrideJob(s,'j',null,now);expect(j.assigned).toEqual(['b']);respond(s,'j','b','DECLINED',now);expect(j.assigned).toEqual(['a']);
});
it('only allows operator penalties after completion for actual workers, not no-shows',()=>{
 const s=setup(),j=s.jobs[0];j.responses={a:'PHONE'};allocateJob(s,j,now);expect(()=>addPenalty(s,'j','a',5,'reason','operator',now)).toThrow();expect(()=>completeJob(s,'j',['a'],'2026-09-17T12:00:00Z')).toThrow();completeJob(s,'j',['a'],now);expect(()=>addPenalty(s,'j','b',5,'reason','operator',now)).toThrow();addPenalty(s,'j','a',5,'reason','operator',now);expect(laborScore(s,'a')).toBe(95);expect(j.assigned).toEqual(['a']);expect(()=>addPenalty(s,'j','a',5,'','operator',now)).toThrow();
});
