import {it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {PrismaClient,type Prisma} from '@prisma/client';
import {db} from '../lib/db';
import {centerRegistry} from '../lib/center-registry';
import {inCenter,recordSpace} from '../lib/workspace';
import {createJointDraft,stageJointDraft,readJointDraftViews,readJointSources} from '../lib/integrated-plan-service';
import {approveProduction,refreshProduction,lockProduction} from '../lib/production-service';
import {lockCenterPool} from '../lib/center-resources';
import {readProductionCoordination,coordinationPolicyKey} from '../lib/production-coordination-store';
import {emptyCoordinationPolicy,aggregateProduction} from '../lib/production-coordination';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal} from '../lib/integrated-plan';
import {jointSource} from './integrated-plan-fixture';

const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function persisted(tx:Prisma.TransactionClient){
 return {centers:await tx.center.findMany({orderBy:{id:'asc'}}),
  records:await tx.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),
  outbox:await tx.outbox.findMany({orderBy:{id:'asc'}}),receipts:await tx.receipt.findMany({orderBy:{id:'asc'}}),
  audit:await tx.audit.findMany({orderBy:{id:'asc'}}),budgets:await tx.aiBudget.findMany({orderBy:{id:'asc'}}),calls:await tx.aiCall.findMany({orderBy:{id:'asc'}})};
}
async function isolated(run:(tx:Prisma.TransactionClient)=>Promise<void>){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test')||process.env.AI_MODE!=='demo'||process.env.NEBIUS_API_KEY)throw Error('Isolated model-free database required');
 const transaction=db.$transaction.bind(db),before=fingerprint(await transaction(tx=>persisted(tx)));
 await expect(transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{in:['shared',...centerRegistry.map(c=>recordSpace(c.id))]}}});
  for(const [index,center] of centerRegistry.entries()){
   // Distinct parcels across centers; shared PNU identities must never hide a
   // national aggregation error in a multi-center fixture.
   const raw=jointSource(center.id,center.id==='demo'?3:center.id==='janggye'?2:0);
   const source=JSON.parse(JSON.stringify(raw).replaceAll('5274036023','527403602'+String(index+3)));
   await tx.center.upsert({where:{id:center.id},create:{id:center.id,state:json(source.state)},update:{state:json(source.state)}});
   const entries:[string,string,unknown][]=[['fields','current',source.fields],['productionCriteria','current',source.criteria],
    ['laborPolicy','2027',{year:2027,hourlyWon:12000,minimumHourlyWon:12000,source:'https://example.com/synthetic-labor-policy',reserveCount:3}],
    ...source.contacts.map((c:any)=>['consultation',c.id,c.payload] as [string,string,unknown]),
    ...source.participations.map((p:any)=>['fieldParticipation',p.pnu,p] as [string,string,unknown])];
   for(const [kind,id,payload] of entries)await tx.workRecord.create({data:{workspace:recordSpace(center.id),kind,id,payload:json(payload)}});
  }
  const policy=emptyCoordinationPolicy();
  policy.yields=['potato','pepper'].map(crop=>({crop:crop as 'potato'|'pepper',commodity:crop==='potato'?'FRESH_POTATO':'DRIED_PEPPER',kgPer1000m2:{low:100,high:200},sourceUrl:'https://example.com/synthetic-yield',method:'Test fixture only',checkedOn:'2026-01-01',validUntil:'2032-12-31'}));
  await tx.workRecord.create({data:{...coordinationPolicyKey,payload:json(policy)}});
  const spy=vi.spyOn(db,'$transaction').mockImplementation(((fn:any)=>fn(tx)) as any);
  try{await run(tx)}finally{spy.mockRestore()}
  throw Error('ROLLBACK_JOINT_FRESHNESS');
 },{timeout:120000})).rejects.toThrow('ROLLBACK_JOINT_FRESHNESS');
 expect(fingerprint(await transaction(tx=>persisted(tx)))).toBe(before);
}
async function stage(tx:Prisma.TransactionClient,audience='demo'){
 return inCenter(audience,async()=>{
  const input={requestId:randomUUID(),mode:'RULES' as const,audience},draft=await createJointDraft(input,'freshness-tester');
  const staged=await stageJointDraft(tx,{requestId:input.requestId,audience,fingerprint:draft.fingerprint},'freshness-tester');
  return {input,draft,staged,approval:{requestId:randomUUID(),fingerprint:staged.view.fingerprint,pnus:staged.view.integratedPlan.choices.map((c:{pnu:string})=>c.pnu)}};
 });
}
async function approveExisting(tx:Prisma.TransactionClient){
 const initial=await refreshProduction(tx),pnu=initial.items.find((item:any)=>item.proposal)?.pnu;
 expect(pnu).toBeTruthy();
 expect((await approveProduction(tx,{requestId:randomUUID(),fingerprint:initial.fingerprint,pnus:[pnu]},'freshness-tester')).fields).toBe(1);
 expect(await tx.workRecord.count({where:{kind:'resourceReservation'}})).toBeGreaterThan(0);
}
it.each(['foreign unapproved field','foreign resources','own labor policy','foreign labor policy'] as const)(
 'rejects approval after %s changes and preserves existing cultivation, reservations and ledger',async change=>isolated(async tx=>{
  await approveExisting(tx);
  const review=await stage(tx);
  if(change==='foreign unapproved field'){
   const key={workspace_kind_id:{workspace:recordSpace('janggye'),kind:'fields',id:'current'}},row=await tx.workRecord.findUniqueOrThrow({where:key});
   const fields=json(row.payload);fields[0].area+=500;
   await tx.workRecord.update({where:key,data:{payload:fields,version:{increment:1}}});
  }else if(change==='foreign resources'){
   const row=await tx.center.findUniqueOrThrow({where:{id:'janggye'}}),state=json(row.state);state.transportCount+=1;
   await tx.center.update({where:{id:'janggye'},data:{state}});
  }else{
   const center=change==='own labor policy'?'demo':'janggye',key={workspace_kind_id:{workspace:recordSpace(center),kind:'laborPolicy',id:'2027'}};
   const row=await tx.workRecord.findUniqueOrThrow({where:key}),policy=json(row.payload);policy.hourlyWon+=1000;
   await tx.workRecord.update({where:key,data:{payload:policy,version:{increment:1}}});
  }
  const before=await persisted(tx);
  expect(before.records.filter(r=>r.kind==='cultivation')).toHaveLength(1);
  await expect(approveProduction(tx,review.approval,'freshness-tester')).rejects.toThrow('변경');
  expect(await persisted(tx)).toEqual(before);
 }),120000);

it('a later center approval invalidates an earlier staged bundle, and recomputation includes committed production once',async()=>isolated(async tx=>{
 await approveExisting(tx);
 const first=await stage(tx,'demo'),second=await stage(tx,'janggye');
 const result=await inCenter('janggye',()=>approveProduction(tx,second.approval,'freshness-tester'));
 expect(result.fields).toBe(second.approval.pnus.length);
 const before=await persisted(tx);
 expect((await readJointDraftViews(tx,'demo')).find(v=>v.requestId===first.input.requestId)?.freshness).toBe('STALE');
 await expect(approveProduction(tx,first.approval,'freshness-tester')).rejects.toThrow('변경');
 expect(await persisted(tx)).toEqual(before);
 const sources=await readJointSources(tx),committed=await readProductionCoordination(tx,'demo',sources[0].today);
 const committedCount=1+result.fields;
 expect(committed.contributions).toHaveLength(committedCount);
 expect(new Set(committed.contributions.map(c=>c.id)).size).toBe(committedCount);
 expect(committed.totals.reduce((n,b)=>n+b.cultivations,0)).toBe(committedCount);
 expect(committed.totals.reduce((n,b)=>n+b.kg.low,0)).toBe(committedCount*100);
 expect(committed.totals.reduce((n,b)=>n+b.kg.high,0)).toBe(committedCount*200);
 for(const source of sources)expect(source.coordination.contributions).toEqual(committed.contributions);
 const snapshot=await collectJointSnapshot(sources,['demo']),proposal=jointRuleProposal(snapshot),evaluated=await evaluateJointProposal(snapshot,proposal);
 expect(evaluated.totals.reduce((n,b)=>n+b.cultivations,0)).toBe(committedCount+snapshot.fields.length);
 expect(evaluated.totals.reduce((n,b)=>n+b.kg.low,0)).toBe((committedCount+snapshot.fields.length)*100);
 expect(()=>aggregateProduction([...committed.contributions,committed.contributions[0]])).toThrow('중복');
 // Repeating an approval receipt cannot add cultivation, output or reservations.
 expect((await inCenter('janggye',()=>approveProduction(tx,second.approval,'freshness-tester'))).alreadyApplied).toBe(true);
 expect(await persisted(tx)).toEqual(before);
 // Diverging versions of the same committed cultivation fail closed.
 const conflicting=structuredClone(snapshot);conflicting.sources[1].coordination.contributions[0].kg!.low+=1;
 await expect(evaluateJointProposal(conflicting,proposal)).rejects.toThrow('기준이 다릅니다');
}),120000);

const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve};};
it.each(['foreign wages','foreign field inventory','foreign equipment'] as const)(
 'keeps %s changes blocked until the approval transaction releases its network locks',async change=>{
  if(!process.env.DATABASE_URL?.endsWith('/kfarm_test')||process.env.AI_MODE!=='demo'||process.env.NEBIUS_API_KEY)throw Error('Isolated model-free database required');
  const before=fingerprint(await db.$transaction(tx=>persisted(tx))),created:string[]=[];
  const competing=new PrismaClient({datasourceUrl:process.env.DATABASE_URL});
  const held=deferred<number>(),attempted=deferred<number>(),release=deferred<void>();
  let holder:Promise<unknown>|undefined,writer:Promise<unknown>|undefined,changed=false;
  try{
   // A second PostgreSQL connection must see the rows. Only absent fixture rows
   // are committed here; both competing transactions roll back, then fixture
   // cleanup must reproduce the complete seven-table starting fingerprint.
   for(const id of ['demo','janggye'])if(!await db.center.findUnique({where:{id}})){
    await db.center.create({data:{id,state:json(jointSource(id,0).state)}});created.push(id);
   }
   holder=db.$transaction(async tx=>{
    await inCenter('demo',()=>lockProduction(tx));
    const [row]=await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;held.resolve(row.pid);
    await release.promise;
    throw Error('ROLLBACK_APPROVAL_LOCKS');
   },{timeout:20000}).catch(error=>error);
   const holderPid=await held.promise;
   writer=competing.$transaction(async tx=>{
    const [row]=await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;attempted.resolve(row.pid);
    if(change==='foreign field inventory'){
     // Same lock used by the field inventory POST before its versioned write.
     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'fields:'+recordSpace('janggye')}))`;
     const key={workspace:recordSpace('janggye'),kind:'fields',id:'current'};
     await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload:[]},update:{payload:[],version:{increment:1}}});
    }else if(change==='foreign wages'){
     // Same owner-center lock used by the labor-policy POST.
     await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${'janggye'} FOR UPDATE`;
     const key={workspace:recordSpace('janggye'),kind:'laborPolicy',id:'2027'};
     const payload={year:2027,hourlyWon:13000,minimumHourlyWon:12000,source:'https://example.com/concurrency-fixture',reserveCount:3};
     await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload},update:{payload,version:{increment:1}}});
    }else{
     await lockCenterPool(tx);
     const center=await tx.center.findUniqueOrThrow({where:{id:'janggye'}}),state=json(center.state);state.transportCount+=1;
     await tx.center.update({where:{id:'janggye'},data:{state,version:{increment:1}}});
    }
    changed=true;
    throw Error('ROLLBACK_FOREIGN_CHANGE');
   },{timeout:20000}).catch(error=>error);
   const writerPid=await attempted.promise;
   // Observe the actual PostgreSQL wait graph rather than assuming a delayed
   // Promise means a write is protected. This fails with the old own-center lock.
   let blocked=false;
   for(let attempt=0;attempt<100;attempt++){
    const [row]=await db.$queryRaw<{blockers:number[]}[]>`SELECT pg_blocking_pids(${writerPid}::int) AS blockers`;
    if(row.blockers.includes(holderPid)){blocked=true;break;}
    if(changed)break;
    await new Promise(done=>setTimeout(done,10));
   }
   expect(blocked).toBe(true);expect(changed).toBe(false);
   release.resolve();
   expect(await holder).toBeInstanceOf(Error);expect((await holder as Error).message).toBe('ROLLBACK_APPROVAL_LOCKS');
   expect(await writer).toBeInstanceOf(Error);expect((await writer as Error).message).toBe('ROLLBACK_FOREIGN_CHANGE');
   expect(changed).toBe(true);
  }finally{
   release.resolve();await Promise.all([holder,writer]);await competing.$disconnect();
   if(created.length)await db.center.deleteMany({where:{id:{in:created}}});
  }
  expect(fingerprint(await db.$transaction(tx=>persisted(tx)))).toBe(before);
 },30000);
