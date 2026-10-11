import {it,expect,beforeAll,vi} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {emptyCenter,centerRegistry} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'TEST'})}));
import {POST as replan} from '../app/api/replanning/route';
import {POST as resources,GET as readResources} from '../app/api/center-resources/route';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const day=(n:number)=>`2027-05-${String(n).padStart(2,'0')}`;
const sessions:Record<string,string>={};
beforeAll(async()=>{
 if(process.env.DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_replan_e2e')throw Error('Disposable replan DB required');
 await db.$transaction(async tx=>{
  await tx.outbox.deleteMany();await tx.receipt.deleteMany();await tx.audit.deleteMany();await tx.workRecord.deleteMany();await tx.center.deleteMany();
  for(const [i,c] of centerRegistry.entries()){
   const s=emptyCenter(c.id);s.staffCount=3;s.transportCount=2;
   s.machines=[{id:c.id==='demo'?'OLD':c.id.toUpperCase()+'TR01',ownerCenterId:c.id,type:'트랙터',name:'트랙터',capacityHaHour:1,status:'AVAILABLE',safetyLock:false}];
   if(c.id==='demo'){
    s.fields=[{id:'field',farmerId:'farmer',name:'홍검증',address:'계북면 가상 신청',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'DEMO_ASSUMPTION'}];
    s.missions=Array.from({length:7},(_,i)=>({id:'task-'+(i+1),fieldId:'field',label:'트랙터 작업',crop:'쌀' as const,owner:'장비' as const,status:'PLANNED' as const,resourceId:'OLD',scheduledDate:day(i+1),month:5,start:2,duration:4,deadline:32,priority:1,batchKey:'test',staff:1,transport:1,predecessorMissionIds:[],planningWindow:{from:day(i+1),to:day(i+2),duration:4,rainSensitive:false,windLimitMs:12,basis:'OPERATOR_PROVISIONAL_WINDOW'}}));
    s.missions.push({...s.missions[0],id:'completed',scheduledDate:'2026-01-01',status:'COMPLETED'});
   }
   await tx.center.create({data:{id:c.id,state:json(s)}});
   // Synthetic geometry tests topology; not a claim about actual Korean borders.
   const x=({demo:0,janggye:1,cheoncheon:2,gyenam:10} as Record<string,number>)[c.id];
   await tx.workRecord.create({data:{workspace:recordSpace(c.id),kind:'centerGeography',id:'current',payload:{source:'TEST_ONLY',geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}}}});
   const id=randomUUID(),token=randomBytes(32).toString('hex');sessions[c.id]=token;
   await tx.workRecord.create({data:{...authKey('user',id),payload:{id,username:id,name:'격리 담당자',centerId:c.id,role:'CENTER_ADMIN',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
   await tx.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});
  }
 });
});
const call=async(center:string,handler:typeof replan,data?:unknown)=>handler(new NextRequest('http://127.0.0.1:3100/api/test',{method:data?'POST':'GET',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100',cookie:'kfarm_session='+sessions[center],'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}));
const post=async(center:string,handler:typeof replan,data:unknown)=>{const r=await call(center,handler,data),b=await r.json();expect(r.status,JSON.stringify(b)).toBe(200);return b};
const preview=(id:string)=>post('demo',replan,{action:'preview',ids:[id],scope:'PRESERVE',reason:'고장 장비 대체',decisionSource:'DEVELOPMENT_REVIEW'});
it('real API and DB: adjacency, pre-authorization, stale denial, seven approvals, bookings and notices',async()=>{
 const foreignBefore=await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}}),calls=await db.aiCall.count();
 expect((await(await call('demo',readResources)).json()).neighborCenterIds).toEqual(['janggye']);
 await post('demo',resources,{action:'failure',machineId:'OLD',from:day(1),expectedRepairOn:day(8)});
 expect((await preview('task-1')).status).toBe('NO_FEASIBLE_PLAN');
 const offer={id:randomUUID(),version:0,machineId:'JANGGYETR01',borrowerCenterId:'demo',from:day(1),to:day(8),compatibleMachineIds:['OLD'],outboundSlots:2,returnSlots:2,agreementRef:'TEST agreement',conditions:'TEST compatibility/crew/transit',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true};
 expect((await call('gyenam',resources,{action:'sharingOffer',offer:{...offer,id:randomUUID(),machineId:'GYENAMTR01'}})).status).toBe(409);
 await post('janggye',resources,{action:'sharingOffer',offer});
 const stale=await preview('task-1');expect(stale.diff[0]).toMatchObject({afterResource:'JANGGYETR01',date:day(1)});
 await post('janggye',resources,{action:'sharingOffer',offer:{...offer,version:1,enabled:false}});
 expect((await call('demo',replan,{action:'approve',proposalId:stale.proposalId})).status).toBe(409);
 expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);
 await post('janggye',resources,{action:'sharingOffer',offer:{...offer,version:2}});
 for(let i=1;i<=7;i++){
  const p=await preview('task-'+i);expect(p.status,JSON.stringify(p)).toBe('FEASIBLE');expect(p.diff).toHaveLength(1);expect(p.diff[0]).toMatchObject({date:day(i),afterResource:'JANGGYETR01'});
  await post('demo',replan,{action:'approve',proposalId:p.proposalId});
  expect((await post('demo',replan,{action:'approve',proposalId:p.proposalId})).alreadyApplied).toBe(true);
 }
 for(const kind of ['equipmentLoan','resourceReservation','taskPlanChange'])expect(await db.workRecord.count({where:{kind}})).toBe(7);
 const s=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
 expect(s.missions.find((m:any)=>m.id==='completed').status).toBe('COMPLETED');expect(s.machines.find((m:any)=>m.id==='OLD').status).toBe('MAINTENANCE');
 expect(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}})).toEqual(foreignBefore);
 const notices=await db.outbox.findMany({where:{id:{startsWith:'replan:'}}});expect(notices).toHaveLength(7);expect(notices.every(n=>n.body.includes('작업일(')&&n.body.includes('유지'))).toBe(true);
 expect(await db.aiCall.count()).toBe(calls);
 const loan={id:randomUUID(),version:0,machineId:'JANGGYETR01',ownerCenterId:'janggye',borrowerCenterId:'cheoncheon',usableFrom:day(2),usableUntil:day(2),status:'REQUESTED',operatorConfirmed:false,transportConfirmed:false};
 await post('cheoncheon',resources,loan);
 expect((await call('janggye',resources,{...loan,version:1,status:'CONFIRMED',operatorConfirmed:true,transportConfirmed:true})).status).toBe(409);
});
