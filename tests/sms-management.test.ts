import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {smsFixture} from './sms-fixture';
import {refreshSms} from '../lib/sms-store';
import {manageMessage,readManagedSms} from '../lib/sms-management-store';
import type {Principal} from '../lib/auth';
const actor={id:'sms-review-test',username:'test',name:'담당자',enabled:true,role:'CENTER_STAFF',centerId:'demo'} as Principal;
const clock='2032-08-27T09:00:00+09:00';
async function fixture(run:()=>Promise<void>){
 const f=await smsFixture();
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(clock));
 try{await refreshSms('demo',clock);await run();}
 finally{vi.useRealTimers();await f.cleanup();}
}
it('saves attendance through the same labor allocation path, replays once and rejects stale changes',async()=>fixture(async()=>{
 const m=(await readManagedSms('demo'))[0],input={id:m.id,version:m.version,laborVersion:m.laborVersion,status:'ATTENDING' as const,requestId:randomUUID()};
 const centers=await db.center.findMany({orderBy:{id:'asc'}}),calls=await db.aiCall.count();
 expect(await manageMessage(actor,input,'review')).toMatchObject({ok:true,realMessages:0});
 const after=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}}),state=after.payload as any;
 expect(state.jobs.find((j:any)=>j.id===m.jobId).responses[m.recipient.id]).toBe('PHONE');
 expect((await readManagedSms('demo')).some(r=>r.recipient.id===m.recipient.id&&r.managementStatus==='ATTENDING')).toBe(true);
 await manageMessage(actor,input,'review');
 expect(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}})).toEqual(after);
 await expect(manageMessage(actor,{...input,requestId:randomUUID(),status:'DECLINED'},'review')).rejects.toThrow('변경');
 expect(await db.center.findMany({orderBy:{id:'asc'}})).toEqual(centers);expect(await db.aiCall.count()).toBe(calls);
}));
it('records resend intent without inventing delivery and denies other-center changes',async()=>fixture(async()=>{
 const m=(await readManagedSms('demo'))[0],input={id:m.id,version:m.version,requestId:randomUUID()},before=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'smsMessage',id:m.id}}});
 await expect(manageMessage({...actor,centerId:'janggye'},input,'resend')).rejects.toThrow();
 expect(await manageMessage(actor,input,'resend')).toMatchObject({delivery:'WAITING_PROVIDER',realMessages:0});
 expect(await manageMessage(actor,input,'resend')).toMatchObject({delivery:'WAITING_PROVIDER'});
 const after=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'smsMessage',id:m.id}}});
 expect((after.payload as any).status).toBe((before.payload as any).status);expect((after.payload as any).attempts).toBe(0);
 expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'smsResendRequest'}})).toBe(1);
}));
it('fails atomically when the linked work moved, without changing message status or attendance',async()=>fixture(async()=>{
 const m=(await readManagedSms('demo'))[0],center=await db.center.findUniqueOrThrow({where:{id:'demo'}}),s=center.state as any;
 s.missions[0].scheduledDate='2032-09-02';await db.center.update({where:{id:'demo'},data:{state:s}});
 const before=await db.workRecord.findMany({where:{workspace:'sandbox',kind:{in:['smsMessage','laborOperations']}}});
 await expect(manageMessage(actor,{id:m.id,version:m.version,laborVersion:m.laborVersion,status:'ATTENDING',requestId:randomUUID()},'review')).rejects.toThrow('현재 작업');
 expect(await db.workRecord.findMany({where:{workspace:'sandbox',kind:{in:['smsMessage','laborOperations']}}})).toEqual(before);
}));

it('manual sent evidence stops automatic duplicate delivery and remains distinguished from a provider receipt',async()=>fixture(async()=>{
 const m=(await readManagedSms('demo'))[0];
 await manageMessage(actor,{id:m.id,version:m.version,laborVersion:m.laborVersion,status:'SENT',requestId:randomUUID()},'review');
 const row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'smsMessage',id:m.id}}});
 expect(row.payload).toMatchObject({status:'SENT',review:{source:'MANUAL',actorId:actor.id}});
 const {simulateSms}=await import('../lib/sms-store');
 await expect(simulateSms('demo',{id:m.id,requestId:randomUUID(),fail:false},clock)).rejects.toThrow('발송 대기');
 expect((await readManagedSms('demo')).filter(r=>r.jobId===m.jobId&&r.recipient.id===m.recipient.id)).toHaveLength(1);
}));
