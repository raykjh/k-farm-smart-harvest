import {it,expect} from 'vitest';
import {smsInput,offset} from './sms-fixture';
import {SMS_POLICY,smsDrafts,noticeAt,type SmsMessage} from '../lib/sms-policy';
import {emptyLaborOps,advanceAttendance,respond,workerSchema} from '../lib/labor-operations';
const now='2032-08-27T09:00:00+09:00';
const sent=(m:SmsMessage,n=1):SmsMessage=>({...m,status:'SIMULATED',processedAt:now,deliverySequence:n,attempts:1});
export const legacyOwner=():SmsMessage=>({id:'f'.repeat(64),policy:SMS_POLICY,recipient:{type:'OWNER',id:'historical-owner',name:'홍소유',phone:'000-0000-0000'},category:'WORK_PLANNED',body:'기존 소유주 안내 기록',scheduledAt:'2032-08-27T00:00:00.000Z',status:'QUEUED',attempts:0,createdAt:now});
it('never generates owner reminders or corrections, including changed and cancelled notified work',()=>{
 const f=smsInput(),history=[sent(legacyOwner())],original=JSON.stringify(history);
 expect(smsDrafts(f.s,emptyLaborOps(),f.contacts,[],now)).toEqual([]);
 f.s.missions[0].scheduledDate='2032-09-03';f.s.missions[1].status='CANCELLED';
 expect(smsDrafts(f.s,emptyLaborOps(),f.contacts,history,now)).toEqual([]);
 expect(JSON.stringify(history)).toBe(original);
});
it('queues only workforce notices, preserves identifiers, and never confirms attendance',()=>{
 const f=smsInput(),before=JSON.stringify(f.labor),out=smsDrafts(f.s,f.labor,f.contacts,[],now);
 expect(out).toHaveLength(1);expect(out[0].recipient.id).toBe(f.labor.people[0].id);expect(out.every(m=>m.recipient.type==='WORKER'&&m.category==='LABOR'&&m.body.includes('문자 답장'))).toBe(true);
 expect(out[0].scheduledAt).toBe(noticeAt(f.date,7));expect(noticeAt('2033-01-03',7)).toBe('2032-12-27T00:00:00.000Z');
 expect(smsDrafts(f.s,f.labor,new Map(),[legacyOwner()],now).map(m=>m.id)).toEqual(out.map(m=>m.id));
 expect(f.labor.notices.every(n=>n.channel==='SMS_PHONE')).toBe(true);expect(JSON.stringify(f.labor)).toBe(before);expect(f.labor.jobs[0].assigned).toEqual([]);
 expect(workerSchema.parse(f.labor.people[0]).usesApp).toBe(false);
});
it('blocks absent worker contact without borrowing an owner contact or inventing a number',()=>{
 const f=smsInput();f.labor.people[0].phone='';
 const out=smsDrafts(f.s,f.labor,f.contacts,[],now);
 expect(out.find(m=>m.recipient.id===f.labor.people[0].id)).toMatchObject({status:'BLOCKED',recipient:{phone:'',type:'WORKER'}});
});
it('suppresses stale, changed-date, declined, completed and withdrawn invitations',()=>{
 const f=smsInput();f.s.missions[0].scheduledDate='2032-09-02';expect(smsDrafts(f.s,f.labor,f.contacts,[],now)).toEqual([]);
 f.s.missions[0].scheduledDate=f.date;f.labor.jobs[0].responses=Object.fromEntries(f.labor.people.map(p=>[p.id,'DECLINED']));expect(smsDrafts(f.s,f.labor,f.contacts,[],now)).toEqual([]);
 f.labor.jobs[0].responses={};f.s.fields[0].serviceStatus='WITHDRAWN';expect(smsDrafts(f.s,f.labor,f.contacts,[],now)).toEqual([]);
 delete f.s.fields[0].serviceStatus;f.s.missions[0].status='COMPLETED';expect(smsDrafts(f.s,f.labor,f.contacts,[],now)).toEqual([]);
});
it('connects SMS confirmation and D-2 replacement without creating owner notices',()=>{
 const f=smsInput(),j=f.labor.jobs[0],a=f.labor.people[0].id,b=f.labor.people[1].id;
 const history=smsDrafts(f.s,f.labor,f.contacts,[],now).map(sent);
 respond(f.labor,j.id,b,'SMS',now);expect(j.assigned).toEqual([]);const cutoff=offset(f.date,-2)+'T09:00:00+09:00';advanceAttendance(f.labor,j,cutoff);
 expect(j.assigned).toEqual([b]);expect(j.responses[a]).toBeUndefined();expect(j.attendance?.expired).toEqual([a]);
 const out=smsDrafts(f.s,f.labor,f.contacts,history,cutoff);expect(out).toHaveLength(2);expect(out.every(m=>m.recipient.type==='WORKER')).toBe(true);expect(out.find(m=>m.recipient.id===a)?.body).toContain('배정 교체');expect(out.find(m=>m.recipient.id===b)?.body).toContain('배정 확정');
 expect(smsDrafts(f.s,f.labor,f.contacts,[...history,...out.map(sent)],cutoff)).toEqual([]);
});
