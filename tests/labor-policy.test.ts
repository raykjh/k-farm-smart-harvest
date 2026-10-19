import {it,expect} from 'vitest';
import {defaultLaborPolicy,laborPolicyInput,payBasis,laborEarnings,halfDayUnits} from '../lib/labor-policy';
import {emptyLaborOps,newAttendance,advanceAttendance,completeJob,recordWorkException,type LaborJob} from '../lib/labor-operations';
import {prepareRecruitment} from '../lib/labor-recruitment';
const policy=defaultLaborPolicy(2026)!;
const job=(id:string,count=2):LaborJob=>({id,missionId:id,date:'2026-10-20',startMinute:480,durationMinutes:120,count,task:'수확',address:'가상 농지',workCode:'harvest',sourceHash:'hash',pay:'',payBasis:payBasis(policy),status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[],attendance:newAttendance()});
it('uses a verified annual minimum and half-day units without treating estimates as payments',()=>{
 expect(policy.hourlyWon).toBe(10320);expect(laborEarnings(payBasis(policy),120)).toBe(41280);
 expect(laborEarnings(payBasis(policy),240,0.5)).toBe(20640);expect(halfDayUnits(300)).toBe(2);
 expect(defaultLaborPolicy(2034)).toBeNull();expect(laborEarnings(undefined,240)).toBeNull();
 expect(()=>laborPolicyInput.parse({...policy,hourlyWon:10000})).toThrow();
 expect(()=>laborPolicyInput.parse({...policy,minimumHourlyWon:10000})).toThrow();
});
it('shares a reserve pool across simultaneous half-day work and never creates people or attendance',()=>{
 const ops={...emptyLaborOps(),reserveCapacityByYear:{'2026':3}},a=job('a'),b={...job('b'),startMinute:600};ops.jobs=[a,b];
 advanceAttendance(ops,a,'2026-10-18T00:00:00+09:00');advanceAttendance(ops,b,'2026-10-18T00:00:00+09:00');
 expect(a.reserveSlots).toEqual(['1','2']);expect(b.reserveSlots).toEqual(['3']);expect(a.responses).toEqual({});expect(ops.people).toHaveLength(0);
 expect(a.worked).toEqual([]);expect(a.reserveWorked).toBeUndefined();
 expect(()=>completeJob(ops,a.id,[],'2026-10-18T00:00:00+09:00',['1'])).toThrow();
 completeJob(ops,a.id,[],'2026-10-20T18:00:00+09:00',['1']);expect(a.reserveWorked).toEqual(['1']);
});
it('keeps manual assignments and subtracts named employees from unnamed reserve capacity',()=>{
 const ops={...emptyLaborOps(),reserveCapacityByYear:{'2026':3}},a=job('a',3);ops.jobs=[a];ops.people=[{id:'named',active:true,employment:'CENTER_RESERVE'} as any];
 advanceAttendance(ops,a,'2026-10-18T00:00:00+09:00');expect(a.reserveSlots).toEqual(['1','2']);
 a.manual=[];advanceAttendance(ops,a,'2026-10-18T00:01:00+09:00');expect(a.reserveSlots).toEqual([]);
});
it('opens committed future labor demands once using common rates, preserving closed jobs',()=>{
 const ops=emptyLaborOps(),d={...job('future'),held:false,completed:false},old={...job('past'),status:'COMPLETED' as const};ops.jobs=[old];
 const policies={'2026':{policy,version:2}},snapshot=structuredClone(old);
 expect(prepareRecruitment(ops,[d],policies,'2026-10-16T00:00:00+09:00')).toBe(1);
 expect(prepareRecruitment(ops,[d],policies,'2026-10-16T00:00:00+09:00')).toBe(0);
 expect(ops.jobs[0]).toEqual(snapshot);expect(ops.jobs[1].payBasis?.policyVersion).toBe(2);expect(ops.jobs[1].assigned).toEqual([]);
});
it('appends half-day exceptions only for completed workers and leaves penalty scores independent',()=>{
 const ops=emptyLaborOps(),j=job('m');j.status='COMPLETED';j.worked=['worker'];ops.jobs=[j];
 const entry={id:'e',jobId:j.id,workerId:'worker',halfDays:0.5,reason:'개인 사정 조기 퇴근',actor:'담당자',at:'2026-10-20T10:00:00Z'};
 recordWorkException(ops,entry);recordWorkException(ops,{...entry,id:'e2',halfDays:1,reason:'원본 근무기록 확인 후 정정'});
 expect(ops.workExceptions).toHaveLength(2);expect(ops.penalties).toEqual([]);
 expect(()=>recordWorkException(ops,{...entry,workerId:'absent'})).toThrow();
});
