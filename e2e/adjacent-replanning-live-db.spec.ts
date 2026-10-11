import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {emptyCenter,centerRegistry} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
const url='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_replan_e2e';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const day=(n:number)=>`2027-05-${String(n).padStart(2,'0')}`;
test.skip(process.env.KFARM_REPLAN_E2E!=='1','Explicit disposable database only');
test.beforeAll(async()=>{
 if(process.env.DATABASE_URL!==url)throw Error('Isolated replan DB required');
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
   // Synthetic geometry for authorization tests, never presented as real borders.
   const x=({demo:0,janggye:1,cheoncheon:2,gyenam:10} as Record<string,number>)[c.id];
   await tx.workRecord.create({data:{workspace:recordSpace(c.id),kind:'centerGeography',id:'current',payload:{source:'TEST_ONLY',geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}}}});
  }
 });
});
test('owner-open neighbor substitution keeps dates; stale approval and lender conflicts fail closed',async({playwright,browser},info)=>{
 const clients:Record<string,APIRequestContext>={},tokens:Record<string,string>={};
 for(const c of centerRegistry){const id=randomUUID(),token=randomBytes(32).toString('hex');tokens[c.id]=token;
  await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:id,name:'격리 담당자',centerId:c.id,role:'CENTER_ADMIN',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
  await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});
  clients[c.id]=await playwright.request.newContext({baseURL:'http://127.0.0.1:3101',extraHTTPHeaders:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100',cookie:'kfarm_session='+token}});
 }
 const post=async(c:string,path:string,data:any)=>{const r=await clients[c].post(path,{data}),b=await r.json();expect(r.ok(),JSON.stringify(b)).toBe(true);return b};
 const preview=async(id:string)=>post('demo','/api/replanning',{action:'preview',ids:[id],scope:'PRESERVE',reason:'고장 장비 대체',decisionSource:'DEVELOPMENT_REVIEW'});
 try{
  const foreignBefore=await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}}),callCount=await db.aiCall.count();
  const offers=(await clients.demo.get('/api/center-resources')).ok();expect(offers).toBe(true);
  const absent=await preview('task-1');expect(absent.status).toBe('FEASIBLE');expect(absent.diff).toHaveLength(0);
  await post('demo','/api/center-resources',{action:'failure',machineId:'OLD',from:day(1),expectedRepairOn:day(8)});
  expect((await preview('task-1')).status).toBe('NO_FEASIBLE_PLAN');
  const offer={id:randomUUID(),version:0,machineId:'JANGGYETR01',borrowerCenterId:'demo',from:day(1),to:day(8),compatibleMachineIds:['OLD'],outboundSlots:2,returnSlots:2,agreementRef:'TEST pre-authorized agreement',conditions:'TEST implement/access/operator/transport',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true};
  expect((await clients.gyenam.post('/api/center-resources',{data:{action:'sharingOffer',offer:{...offer,id:randomUUID(),machineId:'GYENAMTR01'}}})).status()).toBe(409);
  await post('janggye','/api/center-resources',{action:'sharingOffer',offer});
  const stale=await preview('task-1');expect(stale.diff[0]).toMatchObject({afterResource:'JANGGYETR01',date:day(1)});
  await post('janggye','/api/center-resources',{action:'sharingOffer',offer:{...offer,version:1,enabled:false}});
  expect((await clients.demo.post('/api/replanning',{data:{action:'approve',proposalId:stale.proposalId}})).status()).toBe(409);
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);
  await post('janggye','/api/center-resources',{action:'sharingOffer',offer:{...offer,version:2}});
  const ctx=await browser.newContext({extraHTTPHeaders:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100'}});await ctx.addCookies([{name:'kfarm_session',value:tokens.demo,domain:'127.0.0.1',path:'/'}]);
  const page=await ctx.newPage();await page.goto('http://127.0.0.1:3101/reservations');
  await expect(page.getByText('직접 인접 확인 센터',{exact:false})).toBeVisible();
  await page.getByText('사전 허용 장비·공유 조건 관리',{exact:true}).click();
  await expect(page.getByText('TEST', {exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('adjacent-sharing.png'),fullPage:true});await ctx.close();
  for(let i=1;i<=7;i++){
   const r=await preview('task-'+i);expect(r.status).toBe('FEASIBLE');expect(r.diff).toHaveLength(1);expect(r.diff[0]).toMatchObject({date:day(i),afterResource:'JANGGYETR01'});
   await post('demo','/api/replanning',{action:'approve',proposalId:r.proposalId});
   expect((await post('demo','/api/replanning',{action:'approve',proposalId:r.proposalId})).alreadyApplied).toBe(true);
  }
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(7);
  expect(await db.workRecord.count({where:{kind:'resourceReservation'}})).toBe(7);
  expect(await db.workRecord.count({where:{kind:'taskPlanChange'}})).toBe(7);
  const s=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
  expect(s.missions.find((m:any)=>m.id==='completed').status).toBe('COMPLETED');expect(s.machines.find((m:any)=>m.id==='OLD').status).toBe('MAINTENANCE');
  expect(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}})).toEqual(foreignBefore);
  const notices=await db.outbox.findMany({where:{id:{startsWith:'replan:'}}});expect(notices).toHaveLength(7);expect(notices.every(n=>n.body.includes('작업일(')&&n.body.includes('유지'))).toBe(true);
  expect(await db.aiCall.count()).toBe(callCount);
  // Another borrowing center cannot take an already committed day.
  const loan={id:randomUUID(),version:0,machineId:'JANGGYETR01',ownerCenterId:'janggye',borrowerCenterId:'cheoncheon',usableFrom:day(2),usableUntil:day(2),status:'REQUESTED',operatorConfirmed:false,transportConfirmed:false};
  await post('cheoncheon','/api/center-resources',loan);
  expect((await clients.janggye.post('/api/center-resources',{data:{...loan,version:1,status:'CONFIRMED',operatorConfirmed:true,transportConfirmed:true}})).status()).toBe(409);
 }finally{for(const client of Object.values(clients))await client.dispose()}
});
