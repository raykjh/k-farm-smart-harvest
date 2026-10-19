import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {testSession} from './auth-fixture';
import {replacementDurationFixture} from './replacement-duration-fixture';
import {automaticSearchSteps} from '../lib/automatic-replanning';
import {hash} from '../lib/annual-replanning';
import {newAutomaticLease,AUTOMATIC_REPLAN_LEASE_MS} from '../lib/automatic-replan-lease';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_TEST'})}));
import {POST} from '../app/api/replanning/route';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));

it.each(['saved','stale','unprepared','running','concurrent'] as const)('recovers %s interrupted requests without a new decision or duplicate commit',async mode=>{
 const fixture=await laborCapacityFixture(),session=await testSession('CENTER_STAFF'),foreign=await testSession('CENTER_STAFF','gyenam');
 try{
  const {s,m}=replacementDurationFixture();s.machines=s.machines.slice(0,1);s.machines.push({...s.machines[0],id:'JB23TR02',status:'AVAILABLE'});s.centerSharing=undefined;
  await db.center.update({where:{id:'demo'},data:{state:json(s)}});
  const call=async(body:unknown,headers=session.headers)=>{const r=await POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers,body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
  const requestId=randomUUID(),input={ids:[m.id],reason:'중단된 저장 복구 검증'};
  // Prepare through the actual engine and verification paths, then represent a
  // server exit after checkpoint persistence but before its approval call.
  const c=await call({...input,action:'compare',alternatives:automaticSearchSteps,searchMode:'LOCAL_FIRST'});
  expect(c.status,JSON.stringify(c.data)).toBe(200);
  const candidate=c.data.results.find((v:any)=>v.id===c.data.recommendation.alternativeId);
  expect(candidate.status).toBe('FEASIBLE');
  const preview=await call(candidate.previewRequest);expect(preview.status).toBe(200);
  const proposalId=preview.data.proposalId,key={workspace:'sandbox',kind:'automaticReplan',id:requestId};
  const pkey={workspace:'sandbox',kind:'replanning',id:proposalId};
  const proposal=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:pkey}})).payload as any;
  const preparedResult={status:'APPLIED',requestId,changes:preview.data.diff.length,dates:preview.data.diff.map((v:any)=>v.date),source:'RULES'};
  const startedAt=Date.now()-(mode==='running'?0:AUTOMATIC_REPLAN_LEASE_MS+1000),token=randomUUID();
  const receipt={inputHash:hash(input),input,actor:'격리 검증',status:'PROCESSING',startedAt:new Date(startedAt).toISOString(),...newAutomaticLease(token,startedAt),...(mode==='unprepared'?{}:{proposalId,preparedResult})};
  await db.workRecord.create({data:{...key,payload:json(receipt)}});
  if(mode!=='unprepared')await db.workRecord.update({where:{workspace_kind_id:pkey},data:{payload:{...proposal,automaticRequestId:requestId,...(mode==='stale'?{expires:Date.now()-1}:{})}}});
  const before=await db.center.findUniqueOrThrow({where:{id:'demo'}}),decisions=await db.workRecord.count({where:{kind:'planningDecision'}}),calls=await db.aiCall.count(),notices=await db.outbox.count();
  const cross=await call({action:'recoverAutomatic',requestId},foreign.headers);expect(cross.data.status).toBe('FAILED');
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}})).payload).toEqual(json(receipt));
  if(mode!=='unprepared')expect((await call({action:'approve',proposalId})).status).toBe(409);
  const answers=mode==='concurrent'?await Promise.all([call({action:'recoverAutomatic',requestId}),call({action:'recoverAutomatic',requestId})]):[await call({action:'recoverAutomatic',requestId})];
  expect(answers.every(a=>a.status===200)).toBe(true);
  const row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),payload=row.payload as any;
  if(['saved','concurrent'].includes(mode)){
   expect(payload.status).toBe('APPLIED');expect(answers.some(a=>a.data.status==='APPLIED')).toBe(true);
   const after=await db.center.findUniqueOrThrow({where:{id:'demo'}});expect(after.version).toBe(before.version+1);
   expect((after.state as any).missions.find((v:any)=>v.id===m.id).resourceId).toBe('JB23TR02');
   expect(await db.outbox.count()).toBe(notices+1);
   expect(payload.result).toMatchObject(preparedResult);expect(payload.result.changeRows[0]).toMatchObject({id:m.id,changed:['equipment'],before:{resourceId:'JB23TR01'},after:{resourceId:'JB23TR02'}});
   expect((await call({action:'recoverAutomatic',requestId})).data).toEqual(payload.result);
   expect((await call({action:'approve',proposalId})).data.alreadyApplied).toBe(true);
   expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(after);
  }else{
   expect(payload.status).toBe(mode==='running'?'PROCESSING':'FAILED');
   expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(before);expect(await db.outbox.count()).toBe(notices);
   if(mode==='unprepared'){
    // Late work cannot attach/approve an abandoned receipt. A fresh attempt
    // requires an explicit new request and is never triggered by recovery.
    expect((await call({action:'automatic',requestId,...input})).status).toBe(409);
   }
  }
  expect(await db.workRecord.count({where:{kind:'planningDecision'}})).toBe(decisions);expect(await db.aiCall.count()).toBe(calls);
 }finally{await foreign.cleanup();await session.cleanup();await fixture.cleanup()}
},60000);
