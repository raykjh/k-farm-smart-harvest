import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {smsFixture,json,offset} from './sms-fixture';
import {SMS_POLICY} from '../lib/sms-policy';
import {refreshSms,readSms,simulateSms} from '../lib/sms-store';
import {testSession} from './auth-fixture';
import {GET,POST} from '../app/api/messages/route';
const now='2032-08-27T09:00:00+09:00';
const request=(id:string,fail=false)=>({id,requestId:randomUUID(),fail});
it('prepares worker notices idempotently without altering plans, labor or AI usage',async()=>{
 const f=await smsFixture();try{
  const centers=await db.center.findMany({orderBy:{id:'asc'}}),calls=await db.aiCall.count(),labor=await db.workRecord.findMany({where:{kind:'laborOperations'}});
  await refreshSms('demo',now);const a=await readSms('demo');await refreshSms('demo',now);expect(await readSms('demo')).toEqual(a);expect(a).toHaveLength(1);expect(a.every(m=>m.recipient.type==='WORKER')).toBe(true);
  expect(await db.center.findMany({orderBy:{id:'asc'}})).toEqual(centers);expect(await db.aiCall.count()).toBe(calls);expect(await db.workRecord.findMany({where:{kind:'laborOperations'}})).toEqual(labor);
 }finally{await f.cleanup()}
});
it('rejects early worker delivery, records failure and retry once, and prevents duplicate sends',async()=>{
 const f=await smsFixture();try{
  await refreshSms('demo',now);const worker=(await readSms('demo'))[0];
  await expect(simulateSms('demo',request(worker.id),offset(f.date,-8)+'T09:00:00+09:00')).rejects.toThrow('예정일');
  const failed=request(worker.id,true);expect(await simulateSms('demo',failed,now)).toMatchObject({status:'FAILED',attempts:1,realMessages:0});expect(await simulateSms('demo',failed,now)).toMatchObject({attempts:1});
  await expect(simulateSms('demo',{...failed,fail:false},now)).rejects.toThrow('다른 내용');
  const retry=request(worker.id);expect(await simulateSms('demo',retry,now)).toMatchObject({status:'SIMULATED',attempts:2,realMessages:0});expect(await simulateSms('demo',retry,now)).toMatchObject({attempts:2});
  await expect(simulateSms('demo',request(worker.id),now)).rejects.toThrow('발송 대기');expect(await db.workRecord.count({where:{kind:'smsAttempt',workspace:'sandbox'}})).toBe(2);
 }finally{await f.cleanup()}
});
it('retires all unsent owner messages while preserving body, completed history and old Outbox records',async()=>{
 const f=await smsFixture(),outboxId='owner-retirement-'+randomUUID();try{
  const base={policy:SMS_POLICY,recipient:{type:'OWNER',id:f.owner,name:'홍소유',phone:'000-0000-0000'},category:'WORK_PLANNED',body:'기존 기록',scheduledAt:new Date(now).toISOString(),attempts:0,createdAt:now};
  for(const [n,status] of ['QUEUED','FAILED','BLOCKED','SIMULATED'].entries())await db.workRecord.create({data:{workspace:'sandbox',kind:'smsMessage',id:String(n).repeat(64),payload:{...base,id:String(n).repeat(64),status}}});
  await db.outbox.create({data:{id:outboxId,centerId:'demo',farmerId:f.owner,planVersion:1,body:'기존 소유주 기록'}});
  await refreshSms('demo',now);
  expect((await readSms('demo')).every(m=>m.recipient.type==='WORKER')).toBe(true);
  for(let n=0;n<4;n++){const row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'smsMessage',id:String(n).repeat(64)}}});expect(row.payload).toMatchObject({body:'기존 기록',status:n===3?'SIMULATED':'SUPERSEDED'});}
  await expect(simulateSms('demo',request('0'.repeat(64)),now)).rejects.toThrow('발송 대기');
  expect(await db.outbox.findUniqueOrThrow({where:{id:outboxId}})).toMatchObject({body:'기존 소유주 기록',status:'RECORDED_ONLY',attempts:0,sentAt:null});
 }finally{await db.outbox.deleteMany({where:{id:outboxId}});await f.cleanup()}
});
it('does not send a stale worker invitation after schedule change',async()=>{
 const f=await smsFixture();try{
  await refreshSms('demo',now);const first=(await readSms('demo'))[0];f.s.missions[0].scheduledDate='2032-09-02';await f.save();
  await expect(simulateSms('demo',request(first.id),now)).rejects.toThrow('발송 대기');await refreshSms('demo',now);
  expect((await readSms('demo')).every(m=>m.status==='SUPERSEDED')).toBe(true);
 }finally{await f.cleanup()}
});
it('limits worker retries and blocks missing-contact messages without deleting history',async()=>{
 const f=await smsFixture();try{
  await refreshSms('demo',now);const worker=(await readSms('demo'))[0];for(let i=0;i<3;i++)await simulateSms('demo',request(worker.id,true),now);
  await expect(simulateSms('demo',request(worker.id),now)).rejects.toThrow('3회');
  f.labor.people.find(p=>p.id===worker.recipient.id)!.phone='';
  await db.workRecord.update({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}},data:{payload:json(f.labor)}});await refreshSms('demo',now);
  const blocked=(await readSms('demo')).find(m=>m.status==='BLOCKED')!;expect(blocked.recipient.phone).toBe('');await expect(simulateSms('demo',request(blocked.id),now)).rejects.toThrow('발송 대기');
 }finally{await f.cleanup()}
});
it('isolates centers, requires authentication and same origin, and refuses real sending',async()=>{
 const f=await smsFixture(),staff=await testSession('CENTER_STAFF'),other=await testSession('CENTER_STAFF','janggye'),global=await testSession('SUPER_ADMIN',null);
 const req=(headers:Record<string,string>,body?:object)=>new NextRequest('http://127.0.0.1:3100/api/messages',{method:body?'POST':'GET',headers:{...headers,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  expect((await GET(req({host:'127.0.0.1:3100'}))).status).toBe(401);expect((await GET(req(global.headers))).status).toBe(403);
  expect((await POST(req(staff.headers,{action:'prepare'}))).status).toBe(200);const items=(await (await GET(req(staff.headers))).json()).items;expect(items.every((m:any)=>m.recipient.type==='WORKER')).toBe(true);
  expect((await (await GET(req(other.headers))).json()).items).toEqual([]);
  expect((await POST(req(other.headers,{action:'simulate',...request(items[0].id)}))).status).toBe(409);
  expect((await POST(req({...staff.headers,origin:'https://outside.invalid'},{action:'prepare'}))).status).toBe(403);
  expect((await POST(req(staff.headers,{action:'send',id:items[0].id}))).status).toBe(403);
 }finally{await staff.cleanup();await other.cleanup();await global.cleanup();await f.cleanup()}
});
