import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {testSession} from './auth-fixture';
import {GET,POST} from '../app/api/operating-ledger/route';
import {GET as getPolicy,POST as setPolicy} from '../app/api/labor-policy/route';
import {defaultLaborPolicy} from '../lib/labor-policy';
import {summarizeActual} from '../lib/operating-ledger';

it('persists field shipments, task costs, owner payments and append-only corrections with scope and retry protection',async()=>{
 const base=await laborCapacityFixture(),session=await testSession(),other=await testSession('CENTER_ADMIN','janggye'),staff=await testSession('CENTER_STAFF'),cycleId=randomUUID(),pnu='5274036023900010099';
 const testIds:string[]=[],missionId='ledger:'+cycleId,now=new Date(Date.now()+9*3600000).toISOString().slice(0,10),year=Number(now.slice(0,4));
 const request=(path:string,body?:unknown,headers=session.headers)=>new NextRequest('http://127.0.0.1:3100/api/'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const state=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
 state.fields=[{id:pnu,area:1000,address:'격리 기록 검증 농지',source:'DEMO_ASSUMPTION',crop:'고추'}];state.missions=[{id:missionId,cultivationId:cycleId,fieldId:pnu,crop:'고추',label:'수확',scheduledDate:now,status:'COMPLETED',resourceId:null}];
 await db.center.update({where:{id:'demo'},data:{state}});
 await db.workRecord.create({data:{workspace:'sandbox',kind:'cultivation',id:cycleId,payload:{id:cycleId,pnu,crop:'pepper',start:`${year}-01-01`,end:`${year}-12-31`,source:'REGISTERED'}}});
 try{
  const before=await db.workRecord.count({where:{kind:'operatingLedger'}});const view=await GET(request('operating-ledger?year='+year));expect(view.status).toBe(200);expect(await db.workRecord.count({where:{kind:'operatingLedger'}})).toBe(before);
  const input={id:randomUUID(),kind:'SHIPMENT',cultivationId:cycleId,date:now,commodity:'건고추',quantityKg:50,amountWon:400000,memo:'합성 출하 전표'};
  const send=async(body:unknown,headers=session.headers)=>{const r=await POST(request('operating-ledger',body,headers));return {status:r.status,data:await r.json()}};
  expect((await send(input,other.headers)).status).toBe(409);expect((await send(input,staff.headers)).status).toBe(200);
  expect((await send(input)).status).toBe(200);testIds.push(input.id);expect((await send(input)).status).toBe(200);expect((await send({...input,amountWon:1})).status).toBe(409);
  const correction={...input,id:randomUUID(),supersedesId:input.id,quantityKg:45,amountWon:360000,memo:'출하 중량 정정'};
  expect((await send(correction)).status).toBe(200);testIds.push(correction.id);
  expect((await send({...correction,id:randomUUID()})).status).toBe(409);
  for(const kind of ['WORK_COST','OWNER_PAYMENT']){const body={id:randomUUID(),kind,cultivationId:cycleId,date:now,amountWon:kind==='WORK_COST'?60000:250000,...(kind==='WORK_COST'?{missionId}:{}),memo:'검증 전표'};expect((await send(body)).status).toBe(200);testIds.push(body.id);}
  const result=await (await GET(request('operating-ledger?year='+year))).json();const rows=result.entries.filter((e:any)=>e.cultivationId===cycleId);
  expect(rows).toHaveLength(4);expect(summarizeActual(rows,year,'SIMULATED').groups[0]).toMatchObject({fieldCount:1,areaM2:1000,revenue:360000,expense:60000,ownerPaid:250000,balance:50000});
  const foreign=await (await GET(request('operating-ledger?year='+year,undefined,other.headers))).json();expect(foreign.entries.some((e:any)=>e.cultivationId===cycleId)).toBe(false);
  const future={...input,id:randomUUID(),date:'2099-01-01'};expect((await send(future)).status).toBe(409);
  expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(state);
 }finally{await db.workRecord.deleteMany({where:{workspace:'sandbox',OR:[{kind:'operatingLedger',id:{in:testIds}},{kind:'cultivation',id:cycleId}]}});await session.cleanup();await other.cleanup();await staff.cleanup();await base.cleanup();}
});

it('stores center common wages and employee count with versioned history and preserves old rate snapshots',async()=>{
 const fixture=await laborCapacityFixture(),session=await testSession(),key={workspace:'sandbox',kind:'laborPolicy',id:'2026'},prior=await db.workRecord.findUnique({where:{workspace_kind_id:key}}),ids:string[]=[];
 const request=(body?:unknown)=>new NextRequest('http://127.0.0.1:3100/api/labor-policy?year=2026',{headers:session.headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 try{
  if(prior)await db.workRecord.delete({where:{workspace_kind_id:key}});
  const first=await (await getPolicy(request())).json();expect(first).toMatchObject({version:0,policy:{reserveCount:3,hourlyWon:10320}});
  const body={requestId:randomUUID(),version:0,policy:{...defaultLaborPolicy(2026)!,hourlyWon:11000,reserveCount:4}};ids.push(body.requestId);
  expect((await setPolicy(request(body))).status).toBe(200);expect((await setPolicy(request(body))).status).toBe(200);
  expect((await setPolicy(request({...body,requestId:randomUUID()}))).status).toBe(409);
  const read=await (await getPolicy(request())).json();expect(read).toMatchObject({version:1,policy:{reserveCount:4,hourlyWon:11000}});
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborPolicyHistory',id:body.requestId}}})).payload).toHaveProperty('before');
 }finally{await db.workRecord.deleteMany({where:{workspace:'sandbox',OR:[{kind:'laborPolicy',id:'2026'},{kind:'laborPolicyHistory',id:{in:ids}}]}});if(prior)await db.workRecord.create({data:prior as any});await session.cleanup();await fixture.cleanup();}
});
