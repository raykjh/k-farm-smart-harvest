import {it,expect,beforeAll,afterAll,beforeEach,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {emptyCenter} from '../lib/center-registry';
import type {State} from '../lib/types';
import {testSession} from './auth-fixture';
import {GET,POST} from '../app/api/equipment-schedule/route';
import {POST as editEquipment} from '../app/api/equipment/route';
import {asPrincipal} from '../lib/auth';
import {queueEquipmentReview,processEquipmentReview} from '../lib/equipment-scheduling';
import {handleReplanning} from '../lib/replanning-service';
vi.mock('../lib/replanning-service',()=>({handleReplanning:vi.fn()}));
const mockReplan=vi.mocked(handleReplanning);
const spaces=['shared','sandbox','center:janggye'],machine='JB23TR98';
let savedCenters:any[],savedRecords:any[],auditIds:string[],outboxIds:string[],owner:Awaited<ReturnType<typeof testSession>>,borrower:typeof owner;
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const req=(s:typeof owner,body?:unknown)=>new NextRequest('http://127.0.0.1:3100/api/equipment-schedule?machineId='+machine,{headers:s.headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
beforeAll(async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated DB required');
 savedCenters=await db.center.findMany({where:{id:{in:['demo','janggye']}}});savedRecords=await db.workRecord.findMany({where:{workspace:{in:spaces}}});
 auditIds=(await db.audit.findMany({select:{id:true}})).map(r=>r.id);outboxIds=(await db.outbox.findMany({select:{id:true}})).map(r=>r.id);
 owner=await testSession('CENTER_STAFF');borrower=await testSession('CENTER_STAFF','janggye');
});
beforeEach(async()=>{
 vi.unstubAllEnvs();mockReplan.mockReset();
 await db.outbox.deleteMany({where:{id:{notIn:outboxIds}}});
 await db.workRecord.deleteMany({where:{workspace:{in:spaces}}});
 for(const id of ['demo','janggye']){
  const s=emptyCenter(id);s.planVersion=1;
  s.machines=[{id:machine,name:'트랙터',type:'트랙터',status:'AVAILABLE',safetyLock:false,ownerCenterId:'demo',capacityHaHour:1,compatibleCrops:['rice']}];
  s.fields=[{id:id+'-field',farmerId:id+'-farmer',name:'기록 보존',address:'계북면 1',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'fixture',source:'DEMO_ASSUMPTION'}];
  s.missions=[{id:id+'-task',fieldId:s.fields[0].id,crop:'쌀',label:'경운',owner:'장비',resourceId:machine,status:'PLANNED',scheduledDate:id==='demo'?'2099-05-01':'2099-05-02',month:5,start:0,duration:4,deadline:32,priority:1,batchKey:'fixture',staff:0,transport:0}];
  await db.center.upsert({where:{id},create:{id,state:json(s),version:1},update:{state:json(s),version:1}});
  const x=id==='demo'?0:1;
  await db.workRecord.create({data:{workspace:id==='demo'?'sandbox':'center:janggye',kind:'centerGeography',id:'current',payload:{geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}}}});
 }
});
afterAll(async()=>{
 vi.unstubAllEnvs();
 await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{in:spaces}}});if(savedRecords.length)await tx.workRecord.createMany({data:savedRecords});
  for(const c of savedCenters)await tx.center.upsert({where:{id:c.id},create:c,update:{state:c.state,version:c.version}});
  await tx.center.deleteMany({where:{id:{in:['demo','janggye'].filter(id=>!savedCenters.some(c=>c.id===id))}}});
  await tx.audit.deleteMany({where:{id:{notIn:auditIds}}});await tx.outbox.deleteMany({where:{id:{notIn:outboxIds}}});
 },{timeout:30000});
 await owner.cleanup();await borrower.cleanup();
});
it('borrower sees only its machine bookings and cancellation saves once without AI or owner changes',async()=>{
 const snapshot=await (await GET(req(borrower))).json();expect(snapshot.items).toHaveLength(1);expect(snapshot.items[0].centerId).toBe('janggye');
 const before=await db.center.findUniqueOrThrow({where:{id:'demo'}}),body={machineId:machine,ownerVersion:snapshot.ownerVersion,requestId:randomUUID(),cancel:snapshot.items.map(({id,version,centerVersion}:any)=>({id,version,centerVersion}))};
 const response=await POST(req(borrower,body));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({cancelled:1,owned:false,review:null});
 expect((await db.center.findUniqueOrThrow({where:{id:'janggye'}})).state).toMatchObject({missions:[{status:'HELD',resourceId:null}]});
 expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(before);
 expect((await POST(req(borrower,body))).status).toBe(200);expect(mockReplan).not.toHaveBeenCalled();
});
it('owner can cancel a borrower booking and queues regional review without pretending disconnected AI ran',async()=>{
 const snapshot=await (await GET(req(owner))).json();expect(snapshot.items).toHaveLength(2);
 const r=snapshot.items.find((r:any)=>r.centerId==='janggye'),response=await POST(req(owner,{machineId:machine,ownerVersion:snapshot.ownerVersion,requestId:randomUUID(),cancel:[{id:r.id,version:r.version,centerVersion:r.centerVersion}]}));
 expect(response.status,JSON.stringify(await response.clone().json())).toBe(200);const result=await response.json();
 expect(result).toMatchObject({cancelled:1,owned:true,review:{status:'NEEDS_ATTENTION'}});
 expect(result.review.results.every((r:any)=>r.status==='PENDING_AI')).toBe(true);
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'cancelledReservation'}})).toBe(1);
});
it('rolls the whole cancellation set back for locked work and rejects stale schedules',async()=>{
 const row=await db.center.findUniqueOrThrow({where:{id:'demo'}}),s=row.state as unknown as State;Object.assign(s.missions[0],{planningLocked:true});
 await db.center.update({where:{id:'demo'},data:{state:json(s)}});
 const snapshot=await (await GET(req(owner))).json();
 // The linked locked booking is still protected when submitted directly.
 const {missionReservation}=await import('../lib/plan-reservation-sync'),booking=missionReservation('demo',s.missions[0])!;
 await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});
 const updated=await (await GET(req(owner))).json(),before=await db.center.findMany({orderBy:{id:'asc'}});
 const body={machineId:machine,ownerVersion:updated.ownerVersion,requestId:randomUUID(),cancel:updated.items.map(({id,version,centerVersion}:any)=>({id,version,centerVersion}))};
 expect((await POST(req(owner,body))).status).toBe(409);
 expect(await db.center.findMany({orderBy:{id:'asc'}})).toEqual(before);
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'cancelledReservation'}})).toBe(0);
 expect((await POST(req(owner,{...body,ownerVersion:snapshot.ownerVersion+10}))).status).toBe(409);
});
it('repair return preserves tasks, clears only active outage and starts an auditable regional review',async()=>{
 const row=await db.center.findUniqueOrThrow({where:{id:'demo'}}),s=row.state as unknown as State,m=s.machines[0];
 m.status='MAINTENANCE';m.downtimes=[{machineId:machine,from:'2026-01-01',returnOn:'2099-01-01'}];
 await db.center.update({where:{id:'demo'},data:{state:json(s)}});
 const equipment={id:machine,name:m.name,kind:'TR',status:'AVAILABLE',capacityHaHour:1,manufacturer:'',model:'',product:'',purchasedOn:'',servicePhone:'',notes:'',compatibleCrops:['rice']};
 const response=await editEquipment(new NextRequest('http://127.0.0.1:3100/api/equipment',{method:'POST',headers:owner.headers,body:JSON.stringify({version:s.planVersion,existingId:machine,equipment})}));
 expect(response.status,JSON.stringify(await response.clone().json())).toBe(200);
 const result=await response.json();expect(result.reviewId).toBeTruthy();
 const after=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;expect(after.missions).toEqual(s.missions);expect(after.machines[0].status).toBe('AVAILABLE');expect(after.machines[0].downtimes![0].returnOn).toBe(new Date(Date.now()+9*3600000).toISOString().slice(0,10));
});
it('region event invokes the existing AI replan service once per center and keeps replay idempotent',async()=>{
 const id=await db.$transaction(tx=>queueEquipmentReview(tx,machine,owner.principal,'availability test'));
 vi.stubEnv('AI_MODE','nebius');
 const seen:any[]=[];
 mockReplan.mockImplementation(async req=>{const input=await req.json();seen.push(input);return Response.json({status:'APPLIED',changes:0,source:'NEBIUS'}) as any});
 const result=await asPrincipal(owner.principal,()=>processEquipmentReview(id));
 expect(result.status).toBe('COMPLETE');expect(result.results.map(r=>r.status)).toEqual(['UNCHANGED','UNCHANGED']);
 expect(seen).toHaveLength(2);expect(seen.every(b=>b.resourceReview&&b.action==='automatic')).toBe(true);
 expect(seen.map(b=>b.ids)).toEqual([['demo-task'],['janggye-task']]);
 await processEquipmentReview(id);expect(mockReplan).toHaveBeenCalledTimes(2);
});
