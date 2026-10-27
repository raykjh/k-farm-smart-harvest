import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {inCenter} from '../lib/workspace';
import {emptyCenter} from '../lib/center-registry';
import {emptyCoordinationPolicy} from '../lib/production-coordination';
import {coordinationPolicyKey} from '../lib/production-coordination-store';
import {assertDelegatedProductionBounds} from '../lib/production-approval-limits';

it('serializes competing approvals against one remaining participant quota and rolls back the rejected write',async()=>{
 const url=new URL(process.env.DATABASE_URL!);if(url.hostname!=='127.0.0.1'||url.pathname!=='/kfarm_test')throw Error('Disposable local database required');
 const workspace='center:gyenam',centerId='gyenam',today='2026-10-26';
 const before=await db.workRecord.findMany({where:{OR:[coordinationPolicyKey,{workspace,kind:{in:['cultivation','cultivationPlan']}}]}});
 const hadCenter=await db.center.findUnique({where:{id:centerId}});
 const ids=[randomUUID(),randomUUID()];
 const policy=emptyCoordinationPolicy();
 policy.yields=[{crop:'potato',commodity:'POTATO',kgPer1000m2:{low:1000,high:1200},sourceUrl:'https://example.org/synthetic-test',method:'Synthetic transaction test',checkedOn:'2026-01-01',validUntil:'2027-12-31'}];
 // VERIFIED exercises the reviewed-reference branch only in this disposable test.
 policy.planningLimits=[{id:'concurrent-quota',version:'test',commodity:'POTATO',crops:['potato'],centerIds:[centerId],origin:'REGISTERED',from:'2027-01-01',to:'2027-12-31',maxKg:1200,mode:'HARD',basis:'REVIEWED_PARTICIPANT_TARGET',sourceKind:'VERIFIED',sourceUrl:'https://example.org/synthetic-test',checkedOn:'2026-01-01',validUntil:'2027-12-31'}];
 const plan=(id:string)=>({cultivation:{id,pnu:id,crop:'potato',start:'2027-02-01',end:'2027-08-01',source:'REGISTERED'},plan:{context:{},plots:[{pnu:id,crop:'potato',area:1000,tasks:[{operationCode:'harvest',window:{from:'2027-07-01',to:'2027-07-20'}}]}]}});
 try{
  await db.$transaction(async tx=>{
   await tx.workRecord.deleteMany({where:{OR:[coordinationPolicyKey,{workspace,kind:{in:['cultivation','cultivationPlan']}}]}});
   await tx.center.upsert({where:{id:centerId},create:{id:centerId,state:JSON.parse(JSON.stringify(emptyCenter(centerId)))},update:{}});
   await tx.workRecord.create({data:{...coordinationPolicyKey,payload:JSON.parse(JSON.stringify(policy))}});
  });
  const results=await Promise.allSettled(ids.map(id=>inCenter(centerId,()=>db.$transaction(async tx=>{
   const p=plan(id);await assertDelegatedProductionBounds(tx,[p] as any,today);
   await tx.workRecord.create({data:{workspace,kind:'cultivation',id,payload:p.cultivation}});
   await tx.workRecord.create({data:{workspace,kind:'cultivationPlan',id,payload:p.plan}});
   return id;
  }))));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const failed=results.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(failed.reason.message).toMatch(/생산 목표/);
  expect(await db.workRecord.count({where:{workspace,kind:'cultivation',id:{in:ids}}})).toBe(1);
  expect(await db.workRecord.count({where:{workspace,kind:'cultivationPlan',id:{in:ids}}})).toBe(1);
 }finally{
  await db.$transaction(async tx=>{
   await tx.workRecord.deleteMany({where:{OR:[coordinationPolicyKey,{workspace,kind:{in:['cultivation','cultivationPlan']},id:{in:ids}}]}});
   for(const row of before)await tx.workRecord.create({data:{...row,payload:JSON.parse(JSON.stringify(row.payload))}});
   if(!hadCenter)await tx.center.delete({where:{id:centerId}});
  });
 }
});
