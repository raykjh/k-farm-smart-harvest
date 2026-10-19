import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {GET,POST} from '../app/api/labor-operations/route';
import {testSession} from './auth-fixture';
import {laborReviewFixture,today} from './labor-review-fixture';
import {db} from '../lib/db';
import {readSms} from '../lib/sms-store';
import {confirmedAttendanceCount} from '../lib/labor-attendance-review';
const req=(headers:Record<string,string>,body?:object)=>new NextRequest('http://127.0.0.1:3100/api/labor-operations',{method:body?'POST':'GET',headers:{...headers,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
it('saves decline, replacement invitation and explicit attendance atomically under staff permissions',async()=>{
 const f=await laborReviewFixture(),staff=await testSession('CENTER_STAFF'),other=await testSession('CENTER_STAFF','janggye');
 try{
  const calls=await db.aiCall.count(),otherCenter=await db.center.findUniqueOrThrow({where:{id:'janggye'}}),a=f.labor.people[0].id,b=f.labor.people[1].id,j=f.labor.jobs[0];
  expect((await readSms('demo')).filter(m=>m.status==='QUEUED').map(m=>m.recipient.id)).toEqual([a]);
  const initial=await f.read();await GET(req(staff.headers));expect(await f.read()).toEqual(initial);
  const body={action:'saveAttendance',version:initial.version,requestId:randomUUID(),jobIds:[j.id],changes:[{jobId:j.id,personId:a,response:'DECLINED'}]};
  const reply=await POST(req(staff.headers,body));expect(await reply.json()).toMatchObject({ok:true});expect(reply.status).toBe(200);
  const saved=await f.read(),ops=saved.payload as any;expect(ops.jobs[0].responses[a]).toBe('DECLINED');expect(ops.jobs[0].attendance.proposed).toEqual([b]);expect(confirmedAttendanceCount(ops.jobs[0])).toBe(0);
  const messages=await readSms('demo');expect(messages.filter(m=>m.status==='QUEUED').map(m=>m.recipient.id)).toEqual([b]);expect(messages.find(m=>m.recipient.id===a)?.status).toBe('SUPERSEDED');
  expect((await POST(req(staff.headers,body))).status).toBe(200);expect(await readSms('demo')).toEqual(messages);expect(await f.read()).toEqual(saved);
  expect((await POST(req(staff.headers,{...body,requestId:randomUUID()}))).status).toBe(409);
  expect((await POST(req(other.headers,{...body,requestId:randomUUID(),version:1}))).status).toBe(409);
  expect((await POST(req(staff.headers,{...body,version:saved.version,requestId:randomUUID(),changes:[{jobId:j.id,personId:b,response:'ATTENDING'}]}))).status).toBe(200);
  const final=(await f.read()).payload as any;expect(final.jobs[0].assigned).toEqual([b]);expect(confirmedAttendanceCount(final.jobs[0])).toBe(1);expect(final.jobs[0].responses[a]).toBe('DECLINED');
  // A later phone withdrawal keeps the old name and starts the same loop again.
  let version=(await f.read()).version;const c=f.labor.people[2].id;
  expect((await POST(req(staff.headers,{...body,version,requestId:randomUUID(),changes:[{jobId:j.id,personId:b,response:'DECLINED'}]}))).status).toBe(200);
  let repeated=(await f.read()).payload as any;expect(repeated.jobs[0].responses[b]).toBe('DECLINED');expect(repeated.jobs[0].attendance.proposed).toEqual([c]);expect(confirmedAttendanceCount(repeated.jobs[0])).toBe(0);
  expect(((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any).missions[0].laborRecoveryRequired).toBe(true);
  version=(await f.read()).version;expect((await POST(req(staff.headers,{...body,version,requestId:randomUUID(),changes:[{jobId:j.id,personId:c,response:'ATTENDING'}]}))).status).toBe(200);
  repeated=(await f.read()).payload as any;expect(confirmedAttendanceCount(repeated.jobs[0])).toBe(1);expect(repeated.jobs[0].responses).toMatchObject({[a]:'DECLINED',[b]:'DECLINED',[c]:'PHONE'});
  expect(((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any).missions[0].laborRecoveryRequired).toBeUndefined();
  expect((await readSms('demo')).every(m=>m.attempts===0)).toBe(true);expect(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(otherCenter);expect(await db.aiCall.count()).toBe(calls);
 }finally{await staff.cleanup();await other.cleanup();await f.cleanup()}
});
it('edits just basic identity and the employee roster without overwriting scores or work history',async()=>{
 const f=await laborReviewFixture(),staff=await testSession('CENTER_STAFF');try{
  const row=await f.read(),ops=row.payload as any,p=ops.people[0];ops.penalties=[{id:randomUUID(),jobId:'historical',workerId:p.id,points:3,reason:'기존 기록',operator:'기존 담당자',at:today()}];await db.workRecord.update({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}},data:{payload:ops}});
  const save={action:'saveWorker',version:row.version,requestId:randomUUID(),id:p.id,profile:{name:'홍수정',birth:'1961-01-02',phone:'010-0000-1111',address:'변경 주소'}};
  expect((await POST(req(staff.headers,save))).status).toBe(200);let saved=await f.read();expect((saved.payload as any).penalties).toEqual(ops.penalties);expect((saved.payload as any).people[0]).toMatchObject(save.profile);
  expect((await POST(req(staff.headers,{...save,requestId:randomUUID(),version:saved.version,profile:{...save.profile,employment:'CENTER_RESERVE'}}))).status).toBe(409);
  const profiles=[1,2,3].map(n=>({key:'reserve:'+n,name:'상시'+n,phone:'010-0000-000'+n}));expect((await POST(req(staff.headers,{action:'employees',input:{count:3,profiles},version:saved.version,requestId:randomUUID()}))).status).toBe(200);
  saved=await f.read();expect((saved.payload as any).reserveRoster).toMatchObject({count:3,profiles:{'1':{name:'상시1'}}});expect((saved.payload as any).penalties).toEqual(ops.penalties);
  const view=await (await GET(req(staff.headers))).json();expect(view.scores[p.id]).toBe(97);expect(view.reserveCount).toBe(3);
 }finally{await staff.cleanup();await f.cleanup()}
});
