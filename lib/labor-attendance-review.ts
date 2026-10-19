import {z} from 'zod';
import {advanceAttendance,canAssign,newAttendance,type LaborOps,type LaborJob} from './labor-operations';

export const attendanceChange=z.object({jobId:z.string().min(1).max(300),personId:z.union([z.string().uuid(),z.string().regex(/^reserve:\d+$/)]),response:z.enum(['ATTENDING','DECLINED'])}).strict();
export type AttendanceChange=z.infer<typeof attendanceChange>;
export const employeeInput=z.object({count:z.number().int().min(0).max(100),profiles:z.array(z.object({key:z.string().max(60),name:z.string().trim().max(60),phone:z.string().trim().max(30)}).strict()).max(100)}).strict();
export type EmployeeInput=z.infer<typeof employeeInput>;
export function employeeRows(s:LaborOps,capacity=3){
 const named=s.people.filter(p=>p.active&&p.employment==='CENTER_RESERVE');
 const count=s.reserveRoster?.count??capacity;
 return [...named.map(p=>({key:p.id,name:p.name,phone:p.phone})),...Array.from({length:Math.max(0,count-named.length)},(_,i)=>{const slot=String(i+1);return {key:'reserve:'+slot,name:s.reserveRoster?.profiles[slot]?.name??'',phone:s.reserveRoster?.profiles[slot]?.phone??''}})];
}
export function saveEmployees(s:LaborOps,input:EmployeeInput,today:string){
 const named=s.people.filter(p=>p.active&&p.employment==='CENTER_RESERVE'),slots=input.count-named.length;
 if(slots<0)throw Error('기존 상시인력 명단보다 적게 설정할 수 없습니다.');
 const expected=new Set([...named.map(p=>p.id),...Array.from({length:slots},(_,i)=>'reserve:'+String(i+1))]);
 if(input.profiles.length!==expected.size||new Set(input.profiles.map(p=>p.key)).size!==expected.size||input.profiles.some(p=>!expected.has(p.key)))throw Error('상시인력 명단과 인원을 확인하세요.');
 if(s.jobs.some(j=>j.status==='OPEN'&&j.date>=today&&(j.reserveSlots??[]).some(slot=>Number(slot)>slots)))throw Error('파견 일정이 있는 상시인력은 먼저 배정을 조정하세요.');
 const profiles={...s.reserveRoster?.profiles};
 for(const p of input.profiles){
  if((p.name&&!/^[0-9+() -]{8,30}$/.test(p.phone))||(!p.name&&p.phone))throw Error('이름과 연락처를 함께 입력하세요.');
  if(p.key.startsWith('reserve:')){const slot=p.key.slice(8);if(!p.name&&s.jobs.some(j=>j.status==='OPEN'&&j.date>=today&&j.reserveAttendance?.[slot]==='ATTENDING'))throw Error('참석 확인된 상시인력의 이름을 비울 수 없습니다.');profiles[slot]={name:p.name,phone:p.phone};}
  else{const person=named.find(w=>w.id===p.key)!;if(!p.name)throw Error('기존 상시인력의 이름을 입력하세요.');person.name=p.name;person.phone=p.phone;}
 }
 // Keep retired slot details for historical work; they no longer add capacity.
 s.reserveRoster={count:input.count,profiles};
}
export function confirmedAttendanceCount(j:LaborJob|undefined){
 if(!j)return 0;
 if(j.status==='COMPLETED')return j.worked.length+(j.reserveWorked?.length??0)+(j.borrowedNames?.length??0);
 return j.assigned.filter(id=>['APP','SMS','PHONE','STANDBY'].includes(j.responses[id])).length+(j.borrowedNames?.length??0)+(j.reserveSlots??[]).filter(slot=>j.reserveAttendance?.[slot]==='ATTENDING').length;
}
export function visibleWorkerIds(s:LaborOps,j:LaborJob){
 const historical=s.notices.filter(n=>n.jobId===j.id&&n.type!=='INVITE').map(n=>n.workerId);
 return [...new Set([...(j.attendance?.proposed??j.invited),...j.assigned,...Object.keys(j.responses),...historical])].filter(id=>s.people.some(p=>p.id===id));
}
/** Same calculation for preview and commit. Preview runs on a clone only;
 * confirmed attendance always comes from explicit staff input, never AI. */
export function applyAttendanceReview(s:LaborOps,jobIds:string[],changes:AttendanceChange[],now:string){
 if(new Set(jobIds).size!==jobIds.length||new Set(changes.map(c=>c.jobId+':'+c.personId)).size!==changes.length)throw Error('중복 명단입니다.');
 const today=new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
 const jobs=jobIds.map(id=>{const j=s.jobs.find(j=>j.id===id);if(!j||j.status!=='OPEN'||j.date<today)throw Error('현재 또는 앞으로의 작업 명단만 변경할 수 있습니다.');return j});
 if(changes.some(c=>!jobIds.includes(c.jobId)))throw Error('선택한 작업의 참석만 변경할 수 있습니다.');
 // Match the server's cutoff reconciliation before accepting replies.
 for(const j of jobs)advanceAttendance(s,j,now);
 for(const change of changes){
  const j=jobs.find(j=>j.id===change.jobId)!;
  if(change.personId.startsWith('reserve:')){
   const slot=change.personId.slice(8),profile=s.reserveRoster?.profiles[slot];
   if(!j.reserveSlots?.includes(slot)&&!j.reserveAttendance?.[slot])throw Error('배정된 상시인력을 선택하세요.');
   if(change.response==='ATTENDING'&&(!profile?.name||!profile.phone))throw Error('상시인력의 이름과 연락처를 먼저 등록하세요.');
   (j.reserveAttendance??={})[slot]=change.response;
   if(change.response==='ATTENDING')(j.reservePeople??={})[slot]={...profile!};
   continue;
  }
  const p=s.people.find(p=>p.id===change.personId);
  if(!p||!j.invited.includes(p.id))throw Error('안내한 인력의 참석만 확인할 수 있습니다.');
  if(change.response==='ATTENDING'){
   if(j.attendance?.expired.includes(p.id))throw Error('미확답으로 교체된 인력입니다. 현재 안내 대상자를 확인하세요.');
   const response=p.employment==='CENTER_RESERVE'?'STANDBY':'PHONE';
   if(!canAssign(s,{...j,responses:{...j.responses,[p.id]:response}},p))throw Error('참석자의 다른 배정 또는 근무 상태를 확인하세요.');
   j.responses[p.id]=response;
  }else j.responses[p.id]='DECLINED';
 }
 for(const j of jobs.sort((a,b)=>a.date.localeCompare(b.date)||a.startMinute-b.startMinute||a.id.localeCompare(b.id))){
  if(!j.attendance)j.attendance=newAttendance();
  j.manual=null;
  advanceAttendance(s,j,now,true);
 }
 // A positive reply cannot silently become a conflicting or over-capacity
 // waitlist entry. The transaction and the client preview both reject it.
 for(const c of changes.filter(c=>c.response==='ATTENDING')){
  const j=jobs.find(j=>j.id===c.jobId)!;
  const assigned=c.personId.startsWith('reserve:')?j.reserveSlots?.includes(c.personId.slice(8)):j.assigned.includes(c.personId);
  if(!assigned)throw Error('중복 일정 또는 필요 인원을 초과한 참석입니다. 명단을 확인하세요.');
 }
}
