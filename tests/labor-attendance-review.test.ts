import {it,expect} from 'vitest';
import {smsInput} from './sms-fixture';
import {applyAttendanceReview,confirmedAttendanceCount,employeeRows,saveEmployees,visibleWorkerIds} from '../lib/labor-attendance-review';
import {advanceAttendance,newAttendance} from '../lib/labor-operations';
const now='2032-08-27T09:00:00+09:00';
it('keeps preview separate and replaces a declined nominee without invented attendance',()=>{
 const f=smsInput(),j=f.labor.jobs[0],a=f.labor.people[0].id,b=f.labor.people[1].id,before=JSON.stringify(f.labor),preview=structuredClone(f.labor);
 applyAttendanceReview(preview,[j.id],[{jobId:j.id,personId:a,response:'DECLINED'}],now);
 expect(JSON.stringify(f.labor)).toBe(before);const updated=preview.jobs[0];expect(updated.responses[a]).toBe('DECLINED');expect(updated.attendance?.proposed).toEqual([b]);expect(visibleWorkerIds(preview,updated)).toEqual(expect.arrayContaining([a,b]));expect(confirmedAttendanceCount(updated)).toBe(0);
 applyAttendanceReview(preview,[j.id],[{jobId:j.id,personId:b,response:'ATTENDING'}],now);
 expect(updated.assigned).toEqual([b]);expect(confirmedAttendanceCount(updated)).toBe(1);expect(updated.responses[a]).toBe('DECLINED');expect(preview.penalties).toEqual([]);
});
it('counts explicit employee attendance, never just allocated reserve capacity',()=>{
 const f=smsInput(),j=f.labor.jobs[0];f.labor.people=[];f.labor.reserveCapacityByYear={2032:3};j.attendance=newAttendance();j.invited=[];
 advanceAttendance(f.labor,j,'2032-08-31T09:00:00+09:00');expect(j.reserveSlots).toEqual(['1']);expect(confirmedAttendanceCount(j)).toBe(0);
 saveEmployees(f.labor,{count:3,profiles:[1,2,3].map(n=>({key:'reserve:'+n,name:'상시'+n,phone:'010-0000-000'+n}))},'2032-08-31');
 applyAttendanceReview(f.labor,[j.id],[{jobId:j.id,personId:'reserve:1',response:'ATTENDING'}],'2032-08-31T09:00:00+09:00');expect(confirmedAttendanceCount(j)).toBe(1);expect(j.reservePeople?.['1'].name).toBe('상시1');
 applyAttendanceReview(f.labor,[j.id],[{jobId:j.id,personId:'reserve:1',response:'DECLINED'}],'2032-08-31T09:00:00+09:00');expect(j.reserveSlots).toEqual(['2']);expect(j.reserveAttendance?.['1']).toBe('DECLINED');expect(confirmedAttendanceCount(j)).toBe(0);
 expect(()=>saveEmployees(f.labor,{count:1,profiles:[{key:'reserve:1',name:'상시1',phone:'010-0000-0001'}]},'2032-08-31')).toThrow('파견 일정');expect(employeeRows(f.labor)).toHaveLength(3);
});
it('rejects non-invited, past, completed, expired and cross-job replies',()=>{
 const f=smsInput(),j=f.labor.jobs[0],a=f.labor.people[0].id;
 expect(()=>applyAttendanceReview(structuredClone(f.labor),[j.id],[{jobId:j.id,personId:'foreign',response:'ATTENDING'}],now)).toThrow('안내한');
 expect(()=>applyAttendanceReview(structuredClone(f.labor),[j.id],[{jobId:'other',personId:a,response:'DECLINED'}],now)).toThrow('선택한');
 expect(()=>applyAttendanceReview(structuredClone(f.labor),[j.id],[],'2032-09-02T09:00:00+09:00')).toThrow('현재');
 expect(()=>applyAttendanceReview(structuredClone(f.labor),[j.id],[{jobId:j.id,personId:a,response:'ATTENDING'}],'2032-08-30T09:00:00+09:00')).toThrow('교체');
 j.status='COMPLETED';expect(()=>applyAttendanceReview(f.labor,[j.id],[],now)).toThrow('현재');
});
it('rejects simultaneous double-booking and over-capacity confirmation',()=>{
 const f=smsInput(),j=f.labor.jobs[0],a=f.labor.people[0].id,b=f.labor.people[1].id;
 const second={...structuredClone(j),id:'second',missionId:'second',attendance:{...newAttendance(),proposed:[a]}};f.labor.jobs.push(second);
 expect(()=>applyAttendanceReview(structuredClone(f.labor),[j.id,second.id],[{jobId:j.id,personId:a,response:'ATTENDING'},{jobId:second.id,personId:a,response:'ATTENDING'}],now)).toThrow('중복');
 f.labor.jobs=[j];expect(()=>applyAttendanceReview(structuredClone(f.labor),[j.id],[{jobId:j.id,personId:a,response:'ATTENDING'},{jobId:j.id,personId:b,response:'ATTENDING'}],now)).toThrow('필요 인원');
});
it('protects completed employee identity snapshots and requires real contact before confirmation',()=>{
 const f=smsInput(),j=f.labor.jobs[0];f.labor.people=[];f.labor.reserveCapacityByYear={2032:3};j.reserveSlots=['1'];j.attendance=newAttendance();
 expect(()=>applyAttendanceReview(structuredClone(f.labor),[j.id],[{jobId:j.id,personId:'reserve:1',response:'ATTENDING'}],'2032-08-31T09:00:00+09:00')).toThrow('연락처');
 j.status='COMPLETED';j.reservePeople={'1':{name:'이전 이름',phone:'010-0000-0001'}};j.reserveWorked=['1'];const historical=JSON.stringify(j);
 saveEmployees(f.labor,{count:1,profiles:[{key:'reserve:1',name:'새 이름',phone:'010-0000-0002'}]},'2032-09-02');expect(JSON.stringify(j)).toBe(historical);expect(confirmedAttendanceCount(j)).toBe(1);
});
