import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {POST} from '../app/api/production-coordination/route';
import {coordinationPolicyKey} from '../lib/production-coordination-store';
import {emptyCoordinationPolicy} from '../lib/production-coordination';

it('only global administrators can save market references; rejects stale and future evidence',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB required');
 const center=await testSession(),global=await testSession('SUPER_ADMIN',null);
 const original=await db.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}});
 const auditIds=(await db.audit.findMany({select:{id:true}})).map(a=>a.id);
 const request=(headers:Record<string,string>,body:unknown)=>POST(new NextRequest('http://127.0.0.1:3100/api/production-coordination',{method:'POST',headers,body:JSON.stringify(body)}));
 try{
  const policy=emptyCoordinationPolicy();
  policy.marketOutlooks=[{crop:'potato',commodity:'TEST_POTATO',from:'2027-03-01',to:'2027-12-31',pressure:'OVERSUPPLY_RISK',sourceUrl:'https://example.com/test',method:'isolated synthetic test',checkedOn:'2026-01-01',validUntil:'2027-12-31'}];
  const body={version:original?.version??0,policy};
  expect((await request(center.headers,body)).status).toBe(409);
  expect(await db.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}})).toEqual(original);
  const bad=structuredClone(body);bad.policy.marketOutlooks![0].checkedOn='2099-01-01';bad.policy.marketOutlooks![0].validUntil='2099-12-31';
  expect((await request(global.headers,bad)).status).toBe(409);
  expect((await request(global.headers,body)).status).toBe(200);
  expect((await request(global.headers,body)).status).toBe(409);
  const saved=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:coordinationPolicyKey}});
  expect((saved.payload as any).marketOutlooks).toEqual(policy.marketOutlooks);
 }finally{
  if(original)await db.workRecord.update({where:{workspace_kind_id:coordinationPolicyKey},data:{payload:original.payload as any,version:original.version,updatedAt:original.updatedAt}});
  else await db.workRecord.deleteMany({where:coordinationPolicyKey});
  // This file runs serially in the isolated test DB; restore pre-test audits.
  await db.audit.deleteMany({where:{id:{notIn:auditIds}}});
  await center.cleanup();await global.cleanup();
 }
});
