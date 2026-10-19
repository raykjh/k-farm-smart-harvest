import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';

test('the demo screen cannot reinsert a fixed-date snapshot, including through a cached client request',async({page})=>{
 const fixture=await laborCapacityFixture();
 try{
  const preview=await page.request.get('/api/demo-data');expect(preview.status()).toBe(200);
  const info=await preview.json();expect(info).toMatchObject({inputMethod:'ORDINARY_WORKFLOW',legacyInsertEnabled:false});
  const before=await db.center.findMany({orderBy:{id:'asc'}}),calls=await db.aiCall.count();
  await page.goto('/?tab=demo');
  await expect(page).not.toHaveURL(/tab=demo/);
  await expect(page.getByRole('navigation').getByRole('button',{name:'데모',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'데모 데이터 입력',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'데모 데이터 삭제',exact:true})).toHaveCount(0);
  const cached=await page.request.post('/api/demo-data',{data:{action:'insert',token:info.token}});
  expect(cached.status()).toBe(410);expect((await cached.json()).code).toBe('LEGACY_DEMO_IMPORT_RETIRED');
  for(const[path,body] of [
   ['/api/workspace',{action:'injectDemo',workspace:'sandbox'}],
   ['/api/demo',{action:'plan',key:crypto.randomUUID()}],
   ['/api/operations',{action:'plan',key:crypto.randomUUID()}],
  ] as const){
   const retired=await page.request.post(path,{data:body});
   expect(retired.status()).toBe(410);expect((await retired.json()).code).toBe('LEGACY_DEMO_WORKFLOW_RETIRED');
  }
  expect(await db.center.findMany({orderBy:{id:'asc'}})).toEqual(before);expect(await db.aiCall.count()).toBe(calls);
  await page.screenshot({path:'test-results/ui-demo-ordinary-input-policy.png',fullPage:true});
 }finally{await fixture.cleanup()}
});
