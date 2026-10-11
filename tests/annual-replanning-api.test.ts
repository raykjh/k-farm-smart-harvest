import {beforeAll,afterAll,beforeEach,afterEach} from 'vitest';
import {testSession} from './auth-fixture';
let session:Awaited<ReturnType<typeof testSession>>;
beforeAll(async()=>{session=await testSession()});afterAll(async()=>{await session?.cleanup()});
import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
async function clearTestReservations(){if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated database required');await db.workRecord.deleteMany({where:{workspace:'shared',kind:'resourceReservation',id:{startsWith:'plan:demo:'}}});}
beforeEach(clearTestReservations);afterEach(clearTestReservations);
import {registeredDemo} from './registered-demo-fixture';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',kind:'short',points:[],sourceUrl:'test',fetchedAt:'2026-09-10'})}));
import {POST} from '../app/api/replanning/route';
it('batch preferred date preserves first, then expands explicitly and records reason',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-18T07:00:00+09:00'));
 try{const s=registeredDemo().state,base=s.missions.find(m=>m.resourceId==='JB23DR01')!;
 const m={...base,id:'ui-expand-selected',scheduledDate:'2026-09-18',start:0,status:'PLANNED' as const,duration:32,predecessorMissionIds:[],planningWindow:{from:'2026-09-19',to:'2026-09-22',duration:32,windLimitMs:5,rainSensitive:true,basis:'OPERATOR_PROVISIONAL_WINDOW'}};
 const other={...m,id:'ui-expand-other',fieldId:s.fields[1].id,scheduledDate:'2026-09-19'},past={...m,id:'ui-expand-completed',scheduledDate:'2026-09-01',status:'COMPLETED' as const};s.missions=[m,other,past];
 await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:s as any},update:{state:s as any}});
 const call=(body:any)=>POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers:session.headers,body:JSON.stringify(body)}));
 const input={action:'preview',ids:[m.id],day:'2026-09-18',preferred:'2026-09-19',reason:'희망일 우선 배치'};
 const first=await(await call({...input,scope:'PRESERVE'})).json();expect(first.status,JSON.stringify(first)).toBe('FEASIBLE');expect(first.preferredSatisfied).toBe(false);
 const expanded=await(await call({...input,scope:'EXPAND'})).json();expect(expanded.status,JSON.stringify(expanded)).toBe('FEASIBLE');expect(expanded.preferredSatisfied).toBe(true);expect(expanded.phase).toBe('REBUILD_APPROVED');expect(expanded.diff.map((d:any)=>d.id)).toContain(other.id);
 expect((await call({action:'approve',proposalId:expanded.proposalId})).status).toBe(200);const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;expect(saved.missions.find((x:any)=>x.id===past.id)).toEqual(past);
 const records=await db.workRecord.findMany({where:{workspace:'sandbox',kind:'taskPlanChange',id:{startsWith:expanded.proposalId+':'}}});expect(records.length).toBe(2);expect((records[0].payload as any).reason).toBe(input.reason);
 }finally{vi.useRealTimers()}
});
it('approves replacement resource and loan window without overwriting history, then rejects stale arrival',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated database required');
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-18T07:00:00+09:00'));
 try{
  const state=registeredDemo().state,old=state.machines.find(m=>m.id==='JB23DR01')!;old.status='MAINTENANCE';state.machines.push({...old,id:'LOAN-DR',status:'AVAILABLE'});
  const m={...state.missions.find(m=>m.resourceId===old.id)!,id:'replacement-api-test',scheduledDate:'2026-09-18',start:0,status:'PLANNED' as const,duration:4,predecessorMissionIds:[],planningWindow:{from:'2026-09-18',to:'2026-09-24',duration:4,windLimitMs:5,rainSensitive:true,basis:'OPERATOR_PROVISIONAL_WINDOW'}};
  const past={...m,id:'completed-history',scheduledDate:'2026-09-01',status:'COMPLETED' as const};state.missions=[m,past];
  await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:state as any},update:{state:state as any}});
  const call=(body:any)=>POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers:{...session.headers,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const input={action:'preview',ids:[m.id],preferred:'2026-09-19',replacement:{failedId:old.id,replacementId:'LOAN-DR',availableFrom:'2026-09-20',availableUntil:'2026-09-23',arrivalConfirmed:true,compatibilityConfirmed:true,note:'isolated fixture'}};
  const p=await(await call(input)).json();expect(p.status,JSON.stringify(p)).toBe('FEASIBLE');expect(p.diff[0].afterResource).toBe('LOAN-DR');
  expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(state);
  expect((await call({action:'approve',proposalId:p.proposalId})).status).toBe(200);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
  expect(saved.missions.find((x:any)=>x.id===m.id)).toMatchObject({resourceId:'LOAN-DR',scheduledDate:'2026-09-20'});expect(saved.missions.find((x:any)=>x.id===past.id)).toEqual(past);
  expect(saved.machines.find((x:any)=>x.id==='LOAN-DR')).toMatchObject({availableFrom:'2026-09-20',availableUntil:'2026-09-23'});
  expect((await(await call({action:'approve',proposalId:p.proposalId})).json()).alreadyApplied).toBe(true);
  await db.center.update({where:{id:'demo'},data:{state:state as any}});
  const stale=await(await call(input)).json();
  await db.center.update({where:{id:'demo'},data:{state:{...state,machines:state.machines.map(x=>x.id==='LOAN-DR'?{...x,availableFrom:'2026-09-22'}:x)} as any}});
  expect((await call({action:'approve',proposalId:stale.proposalId})).status).toBe(409);
 }finally{vi.useRealTimers()}
},30000);
it('stores a proposal without changing the plan, approves atomically and deduplicates',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated database required');
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-10T07:00:00+09:00'));
 try{
 const state=registeredDemo().state;
 // This approval fixture establishes prior work as completed; unresolved past
 // predecessors must not silently become completed merely to satisfy the solver.
 for(const m of state.missions)if(m.scheduledDate!<'2026-09-10')m.status='COMPLETED';
 await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:state as any},update:{state:state as any}});
 const ids=state.missions.filter(m=>m.scheduledDate==='2026-09-10'&&m.status!=='COMPLETED').map(m=>m.id);
 const call=(body:any)=>POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers:{...session.headers,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 const result=await (await call({action:'preview',ids,day:'2026-09-10'})).json();expect(result.status,JSON.stringify(result)).toBe('FEASIBLE');expect(result.diff.length).toBeGreaterThan(0);
 expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(state);
 expect((await call({action:'approve',proposalId:result.proposalId})).status).toBe(200);
 const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;expect(saved.planVersion).toBe(2);
 expect((await (await call({action:'approve',proposalId:result.proposalId})).json()).alreadyApplied).toBe(true);
 expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(saved);
 const notices=await db.outbox.findMany({where:{id:{startsWith:'replan:'+result.proposalId+':'}}});expect(notices.length).toBeGreaterThan(0);
 // New proposal becomes invalid after a plan edit.
 const next=await (await call({action:'preview',ids:[ids[0]],preferred:'2026-09-13'})).json();
 if(next.status==='FEASIBLE'){
  await db.center.update({where:{id:'demo'},data:{state:{...saved,planVersion:3}}});
  expect((await call({action:'approve',proposalId:next.proposalId})).status).toBe(409);
 }
 }finally{vi.useRealTimers()}
},30000);
