import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {saveRegistration} from '../lib/registration-service';
import {refreshProduction,productionKey,approveProduction,changeParticipation,calculateProduction,readProductionSource} from '../lib/production-service';
import {emptyConditions} from '../lib/field-conditions';
import {registeredDemo} from './registered-demo-fixture';
import {intakeField} from '../lib/registration-intake';
import type {Prisma} from '@prisma/client';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
async function isolated(fn:(tx:Prisma.TransactionClient)=>Promise<void>){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB only');
 const before=await db.workRecord.count(),notices=await db.outbox.count();
 await expect(db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{in:['sandbox','shared']}}});
  const s={...registeredDemo().state,fields:[],missions:[]};
  await tx.center.upsert({where:{id:'demo'},create:{id:'demo',state:json(s)},update:{state:json(s)}});
  const payload={profiles:[{id:'test-season',name:'격리 검증용 작기',context:{region:'계북면',operations:{rice:Object.fromEntries(['seed','nursery','soil','plant','harvest','finish'].map(code=>[code,{from:'2032-01-02',to:'2032-02-28',laborMinutesPer1000m2:30}]))}}}]};
  await tx.workRecord.create({data:{workspace:'sandbox',kind:'productionCriteria',id:'current',payload}});
  await fn(tx);throw Error('ROLLBACK_CONTINUOUS_PRODUCTION');
 },{timeout:60000})).rejects.toThrow('ROLLBACK_CONTINUOUS_PRODUCTION');
 expect(await db.workRecord.count()).toBe(before);expect(await db.outbox.count()).toBe(notices);
}
function registration(n:number,version:number){const {geometry,selected,...f}=intakeField('527403602310616000'+n,'계북면 검증 '+n);return {requestId:randomUUID(),consultationId:randomUUID(),consultationVersion:0,fieldVersion:version,testDataOnly:true,continuousService:{from:'2026-01-01',until:null,continuousConsent:true},consultation:{farmer:{name:'홍검증'+n,birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},application:{policy:'OWNER_SERVICE_V1',residence:'계북면',cultivationHistory:'',supportReason:'',exceptionReason:'',review:'pending'},consent:true,step:3,fields:[{...f,area:'1000',mode:'delegated',conditions:{...emptyConditions(),region:'계북면',landUse:'paddy',water:'yes',machineAccess:'yes',laborAvailable:'yes',climate:{rice:'suitable',potato:'unsuitable',pepper:'unsuitable'},evidence:'격리 검증',checkedOn:'2026-09-01'}}]},cultivations:[]}}
it('sequential registration immediately accumulates proposals; approval atomically saves common bookings, labor and notifications',async()=>isolated(async tx=>{
 const first=registration(2,0),a=await saveRegistration(tx,first,'tester');expect(a.production.items[0].status).toBe('REVIEW');
 const second=registration(1,a.fieldVersion);await saveRegistration(tx,second,'tester');const view=await refreshProduction(tx);
 expect(view.items.map((i:any)=>i.pnu)).toEqual([first.consultation.fields[0].pnu,second.consultation.fields[0].pnu]);
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(0);
 const beforeCenter=await tx.center.findUniqueOrThrow({where:{id:'demo'}});expect((beforeCenter.state as any).missions).toHaveLength(0);
 const input={requestId:randomUUID(),fingerprint:view.fingerprint,pnus:view.items.map((i:any)=>i.pnu)};
 const approved=await approveProduction(tx,input,'tester');expect(approved).toMatchObject({fields:2,assigned:12,notifications:2});
 expect((await approveProduction(tx,input,'tester')).alreadyApplied).toBe(true);
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(2);
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'annualReservation'}})).toBe(12);
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'laborDemand'}})).toBe(12);
 expect(await tx.workRecord.count({where:{workspace:'shared',kind:'resourceReservation'}})).toBeGreaterThan(0);
 expect((await refreshProduction(tx)).items.every((i:any)=>i.status==='SCHEDULED')).toBe(true);
 const count=await tx.workRecord.count();await refreshProduction(tx);expect(await tx.workRecord.count()).toBe(count);
 expect((await saveRegistration(tx,first,'tester')).alreadyApplied).toBe(true);
}));
it('changed equipment invalidates pending approval; no partial saves; pause retains history and rejects stale edits',async()=>isolated(async tx=>{
 const b=registration(1,0);await saveRegistration(tx,b,'tester');const view=await refreshProduction(tx);
 const c=await tx.center.findUniqueOrThrow({where:{id:'demo'}}),s=c.state as any;s.machines=[];await tx.center.update({where:{id:'demo'},data:{state:s}});
 await expect(approveProduction(tx,{requestId:randomUUID(),fingerprint:view.fingerprint,pnus:[b.consultation.fields[0].pnu]},'tester')).rejects.toThrow('변경');
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(0);
 expect((await refreshProduction(tx)).items[0].status).toBe('BLOCKED');
 const old=await tx.workRecord.findUniqueOrThrow(productionKey('fieldParticipation',b.consultation.fields[0].pnu)),p=old.payload as any;
 const paused=await changeParticipation(tx,p.pnu,{status:'PAUSED',reason:'요청에 따른 중지',expectedChangedAt:p.changedAt},'tester');expect(paused.items[0].status).toBe('PAUSED');
 await expect(changeParticipation(tx,p.pnu,{status:'ACTIVE',reason:'오래된 화면',expectedChangedAt:p.changedAt},'tester')).rejects.toThrow('변경');
 const changed=await tx.workRecord.findUniqueOrThrow(productionKey('fieldParticipation',p.pnu));expect((changed.payload as any).receivedAt).toBe(p.receivedAt);
}));
it('cross-center reservations constrain calculation without becoming executable local missions',async()=>isolated(async tx=>{
 const b=registration(1,0);await saveRegistration(tx,b,'tester');const source=await readProductionSource(tx),initial=(await calculateProduction(source)),first=initial.items[0].proposal!.dispatch.assignments.find((a:any)=>a.machineId)!;
 const from=Date.parse(first.date+'T00:00:00+09:00')+first.startMinute*60000;
 source.shared=[{id:'remote-test',centerId:'neighbor',resourceId:first.machineId,taskId:'remote',from:new Date(from).toISOString(),to:new Date(from+first.durationMinutes*60000).toISOString()}];
 const next=(await calculateProduction(source));const all=next.items[0].proposal!.dispatch.assignments;
 expect(all.some((a:any)=>a.machineId===first.machineId&&a.date===first.date&&a.startMinute===first.startMinute)).toBe(false);
 expect(source.state!.missions).toHaveLength(0);expect(all.some((a:any)=>String(a.taskId).startsWith('occupancy:'))).toBe(false);
}));
it('completed cultivation rolls into the next linked cycle while all previous work and plans remain unchanged',async()=>isolated(async tx=>{
 const b=registration(1,0);await saveRegistration(tx,b,'tester');const first=await refreshProduction(tx);
 await approveProduction(tx,{requestId:randomUUID(),fingerprint:first.fingerprint,pnus:[b.consultation.fields[0].pnu]},'tester');
 const oldCycle=await tx.workRecord.findFirstOrThrow({where:{workspace:'sandbox',kind:'cultivation'}}),oldPlan=await tx.workRecord.findUniqueOrThrow(productionKey('cultivationPlan',oldCycle.id));
 const row=await tx.center.findUniqueOrThrow({where:{id:'demo'}}),s=row.state as any;s.missions.forEach((m:any)=>m.status='COMPLETED');const actuals=json(s.missions);await tx.center.update({where:{id:'demo'},data:{state:s}});
 const criteria=await tx.workRecord.findUniqueOrThrow(productionKey('productionCriteria')),c=criteria.payload as any;
 for(const r of Object.values(c.profiles[0].context.operations.rice) as any[]){r.from='2032-04-01';r.to='2032-07-01'}await tx.workRecord.update({...productionKey('productionCriteria'),data:{payload:c}});
 const now=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2032-03-01T00:00:00+09:00'));
 try{
  const next=await refreshProduction(tx);expect(next.items[0].proposal.cultivation.previousId).toBe(oldCycle.id);
  await approveProduction(tx,{requestId:randomUUID(),fingerprint:next.fingerprint,pnus:[b.consultation.fields[0].pnu]},'tester');
  const after=await tx.center.findUniqueOrThrow({where:{id:'demo'}}),missions=(after.state as any).missions;
  expect(missions.slice(0,actuals.length)).toEqual(actuals);expect(missions).toHaveLength(12);
  expect((await tx.workRecord.findUniqueOrThrow(productionKey('cultivationPlan',oldCycle.id))).payload).toEqual(oldPlan.payload);
  expect((await tx.workRecord.findUniqueOrThrow(productionKey('cultivation',oldCycle.id))).payload).toEqual(oldCycle.payload);
  expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(2);
 }finally{now.mockRestore()}
}));
it('keeps newly registered fields visible when the center resource ledger is not configured yet',async()=>isolated(async tx=>{
 await tx.center.delete({where:{id:'demo'}});const r=await saveRegistration(tx,registration(1,0),'tester');expect(r.fields).toBe(1);expect(r.production.items).toHaveLength(1);expect(r.production.items[0].status).toBe('BLOCKED');
}));

it('refuses approval when the freshly calculated placement differs from the reviewed placement',async()=>isolated(async tx=>{
 const b=registration(1,0);await saveRegistration(tx,b,'tester');const view=await refreshProduction(tx);
 const changed=json(view);changed.items[0].proposal.dispatch.assignments[0].startMinute+=15;
 await tx.workRecord.update({...productionKey('continuousProduction'),data:{payload:changed}});
 const before=await tx.center.findUniqueOrThrow({where:{id:'demo'}}),notices=await tx.outbox.count();
 await expect(approveProduction(tx,{requestId:randomUUID(),fingerprint:view.fingerprint,pnus:[b.consultation.fields[0].pnu]},'tester')).rejects.toThrow('검토한 내용');
 expect(await tx.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(before);
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(0);
 expect(await tx.outbox.count()).toBe(notices);
}));
