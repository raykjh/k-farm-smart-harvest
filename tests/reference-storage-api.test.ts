import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {importPriceHistory,readPriceHistory} from '../lib/price-reference-store';
import {GET as prices,POST as collect} from '../app/api/price-reference/route';
import {POST as saveEconomics} from '../app/api/economic-reference/route';
import {coordinationPolicyKey,readProductionCoordination} from '../lib/production-coordination-store';
import {economicScenarioReference} from './integrated-economics-fixture';
it('stores provider history idempotently, authorizes source edits, rechecks revisions and preserves ledgers',async()=>{
 const url=new URL(process.env.DATABASE_URL!);if(url.hostname!=='127.0.0.1'||url.pathname!=='/kfarm_test')throw Error('Test DB only');
 const global=await testSession('SUPER_ADMIN',null),staff=await testSession('CENTER_STAFF'),query={crop:'potato' as const,from:'2026-10-18',to:'2026-10-19'},ids=['potato:2026-10-18','potato:2026-10-19'];
 const previous=await db.workRecord.findMany({where:{workspace:'shared',OR:[{kind:'atPriceDay',id:{in:ids}},{kind:'productionCoordinationPolicy',id:'current'}]}}),ledger=await db.aiBudget.findMany(),calls=await db.aiCall.count();
 const raw={ctgry_cd:'100',item_cd:'152',item_nm:'감자',exmn_ymd:'20261019',vrty_cd:'00',vrty_nm:'감자',grd_cd:'04',grd_nm:'상품',se_cd:'02',se_nm:'중도매',sgg_cd:'1101',sgg_nm:'서울',mrkt_cd:'market',mrkt_nm:'시장',unit:'kg',unit_sz:'20',exmn_dd_prc:'20000',exmn_dd_cnvs_prc:'1000',orgnl_reg_dt:'2026-10-19T00:00:00Z'};
 const fetcher=async()=>new Response(JSON.stringify({response:{header:{resultCode:'0'},body:{totalCount:1,items:{item:[raw]}}}}));
 const request=(path:string,session:typeof global,body?:unknown)=>new NextRequest('http://127.0.0.1:3100/api/'+path,{method:body?'POST':'GET',headers:session.headers,...body?{body:JSON.stringify(body)}:{}});
 try{
  expect((await collect(request('price-reference',staff,query))).status).toBe(403);
  const first=await importPriceHistory(query,'test',{fetcher,key:'test-only',today:'2026-10-20'}),again=await importPriceHistory(query,'test',{fetcher,key:'test-only',today:'2026-10-20'});expect(first.observations).toBe(1);expect(again.changed).toBe(0);
  const history=await readPriceHistory(query);expect(history.days).toHaveLength(2);expect(history.missingDays).toEqual([]);expect(history.days[0].status).toBe('NO_OBSERVATIONS');expect((await prices(request('price-reference?'+new URLSearchParams(query),staff))).status).toBe(200);
  const row=history.observations[0],ref=economicScenarioReference('potato');ref.version='price-linked-test';ref.price={low:1000,base:1000,high:1000,unit:'KRW_PER_KG',stage:'WHOLESALE',basis:'HISTORICAL_SCENARIO'};ref.priceEvidence={query,selection:{varietyCode:row.varietyCode,gradeCode:row.gradeCode,stage:'WHOLESALE',regionCode:row.regionCode,marketCode:row.marketCode},revisions:history.days.map(d=>({date:d.date,revision:d.revision}))};
  const policy=await db.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}}),version=policy?.version??0;
  expect((await saveEconomics(request('economic-reference',staff,{version,reference:ref}))).status).toBe(403);
  expect((await saveEconomics(request('economic-reference',global,{version,reference:ref}))).status).toBe(200);
  expect((await saveEconomics(request('economic-reference',global,{version,reference:ref}))).status).toBe(409);
  expect((await readProductionCoordination(db,'demo','2026-10-20')).policy.economicReferences?.some(r=>r.version===ref.version)).toBe(true);
  raw.exmn_dd_prc='22000';raw.exmn_dd_cnvs_prc='1100';await importPriceHistory(query,'test',{fetcher,key:'test-only',today:'2026-10-20'});
  const revised=await readProductionCoordination(db,'demo','2026-10-20');expect(revised.excludedEconomicReferences).toContainEqual({version:ref.version,reason:'PRICE_HISTORY_CHANGED_OR_INCOMPLETE'});expect(revised.policy.economicReferences?.some(r=>r.version===ref.version)).toBe(false);
  expect(await db.aiBudget.findMany()).toEqual(ledger);expect(await db.aiCall.count()).toBe(calls);
 }finally{await db.workRecord.deleteMany({where:{workspace:'shared',OR:[{kind:'atPriceDay',id:{in:ids}},{kind:'productionCoordinationPolicy',id:'current'}]}});for(const row of previous)await db.workRecord.create({data:{...row,payload:JSON.parse(JSON.stringify(row.payload))}});await global.cleanup();await staff.cleanup();}
});
