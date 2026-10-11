import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {readProductionCoordination,coordinationPolicyKey} from '../lib/production-coordination-store';
import {emptyCoordinationPolicy} from '../lib/production-coordination';
import {permitted} from '../lib/auth-policy';
import {testPrincipal} from './auth-fixture';
it('aggregates four-center cultivation plans without exposing owner contacts and keeps unknown yield distinct',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB required');
 await expect(db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{kind:{in:['cultivation','cultivationPlan','productionCoordinationPolicy']}}});
  const policy=emptyCoordinationPolicy();policy.yields.push({crop:'rice',commodity:'MILLED_RICE',kgPer1000m2:{low:400,high:500},sourceUrl:'https://example.com/test',method:'test only',checkedOn:'2026-01-01',validUntil:'2032-12-31'});
  await tx.workRecord.create({data:{...coordinationPolicyKey,payload:JSON.parse(JSON.stringify(policy))}});
  for(const [workspace,id,crop] of [['sandbox','one','rice'],['center:janggye','two','rice'],['center:gyenam','three','pepper']] as const){
   await tx.workRecord.create({data:{workspace,kind:'cultivation',id,payload:{id,pnu:'123',crop,start:'2032-01-01',end:'2033-01-01',source:'REGISTERED'}}});
   await tx.workRecord.create({data:{workspace,kind:'cultivationPlan',id,payload:{context:{},plots:[{pnu:'123',area:1000,crop,consultationId:'private-owner',tasks:[{operationCode:'harvest',window:{from:'2032-10-01',to:'2032-10-31'}}]}]}}});
  }
  const result=await readProductionCoordination(tx,'demo','2026-10-03');expect(result.totals).toEqual([{commodity:'MILLED_RICE',year:2032,origin:'REGISTERED',kg:{low:800,high:1000},cultivations:2}]);expect(result.unquantified).toBe(1);expect(JSON.stringify(result)).not.toContain('private-owner');
  throw Error('ROLLBACK_COORDINATION');
 })).rejects.toThrow('ROLLBACK_COORDINATION');
});
it('allows global references and own-center administration but denies staff edits',()=>{
 expect(permitted({...testPrincipal,role:'SUPER_ADMIN',centerId:null},'production-coordination','POST',{})).toBe(true);
 expect(permitted({...testPrincipal,role:'CENTER_STAFF'},'production-coordination','POST',{})).toBe(false);
});
