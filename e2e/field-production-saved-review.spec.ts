import {test,expect} from './authenticated-test';
import {createHash} from 'node:crypto';
import {db} from '../lib/db';
import {aiBudgetDb} from '../lib/ai-budget-ledger';
import type {State} from '../lib/types';

// Inspect retained synthetic business records only. No seed, inference or approval.
test.skip(process.env.KFARM_FIELD_PRODUCTION_SAVED_REVIEW!=='1','Opt-in retained DB read-only review');
async function fingerprint(){
 const [records,centers,outbox]=await Promise.all([
  db.workRecord.findMany({where:{NOT:{workspace:'auth'}},orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),
  db.center.findMany({orderBy:{id:'asc'}}),db.outbox.findMany({orderBy:{id:'asc'}}),
 ]);
 return createHash('sha256').update(JSON.stringify({records,centers,outbox})).digest('hex');
}
test('retained field production, owner and work records remain readable with zero business writes',async({page,context})=>{
 if(process.env.DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e')throw Error('Isolated retained DB required');
 const before=await fingerprint(),callsBefore=await aiBudgetDb().aiCall.count(),writes:string[]=[],errors:string[]=[];
 await context.route('**/*',r=>{
  const url=new URL(r.request().url());if(url.origin!=='http://127.0.0.1:3100')return r.abort();
  if(url.pathname==='/api/map-tile')return r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'});
  if(url.pathname==='/api/parcels')return r.fulfill({json:{status:'NOT_CONFIGURED'}});
  if(r.request().method()!=='GET'){writes.push(url.pathname);return r.abort()}
  return r.continue();
 });
 page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1050});await page.goto('/?tab=fields');
 await expect(page.getByTestId('ops-fields')).toBeVisible();
 const state=(await (await page.request.get('/api/workspace')).json()).state as State;
 const saved=(await (await page.request.get('/api/continuous-production')).json()).view;
 const field=state.fields.find(f=>f.serviceStatus!=='WITHDRAWN'&&saved?.items.some((i:{pnu:string})=>i.pnu===f.id))!;
 expect(field).toBeTruthy();const item=saved.items.find((i:{pnu:string})=>i.pnu===field.id);
 const row=page.getByTestId('managed-field-'+field.id);await expect(row).toContainText(field.address);
 await page.screenshot({path:'.data/verification/managed-fields-retained.png',fullPage:true});
 await row.getByRole('button',{name:'관리',exact:true}).click();const dialog=page.getByRole('dialog',{name:'농지 관리',exact:true});
 await expect(dialog.getByRole('tabpanel')).toContainText(field.name);
 await dialog.getByRole('tab',{name:'작물·생산',exact:true}).click();const production=dialog.getByTestId('continuous-production');
 await expect(production.locator('.production-field')).toHaveCount(1);await expect(production.getByRole('region',{name:'작물·자원 통합계획',exact:true})).toHaveCount(0);
 if(item.history.length){await production.getByText('누적 재배기록',{exact:false}).click();await expect(production).toContainText(item.history[0].start)}
 await dialog.locator('.field-management-body').evaluate(el=>el.scrollTop=0);await dialog.screenshot({path:'.data/verification/field-production-retained.png'});
 await dialog.getByRole('tab',{name:'작업 이력',exact:true}).click();const work=dialog.getByTestId('field-work-history');await expect(work).toBeVisible();
 const report=await (await page.request.get('/api/work-reports')).json();await expect(work.locator('tbody tr')).toHaveCount(report.rows.filter((r:{fieldId:string})=>r.fieldId===field.id).length);
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();await expect(row).toBeVisible();
 expect(writes).toEqual([]);expect(errors).toEqual([]);expect(await fingerprint()).toBe(before);expect(await aiBudgetDb().aiCall.count()).toBe(callsBefore);
});
