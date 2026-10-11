import {test,expect} from './authenticated-test';
import {capacityScaleFixture} from '../tests/capacity-scale-fixture';
import {db} from '../lib/db';
import {contentHash} from '../lib/capacity-study-input';
import {mkdirSync,writeFileSync} from 'node:fs';

test('imports, saves, calculates and reloads 1,277 work tasks through real API and DB without modifying operational records',async({page})=>{
 test.setTimeout(180000);
 page.setDefaultTimeout(20000);
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated capacity study DB required');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const operational=async()=>contentHash({centers:await db.center.findMany({orderBy:{id:'asc'}}),outbox:await db.outbox.findMany({orderBy:{id:'asc'}}),receipts:await db.receipt.count(),calls:await db.aiCall.count()});
 const before=await operational();let baselineId='';
 const path='.data/validation/20261003-capacity-partitions';mkdirSync(path,{recursive:true});
 try{
  await page.goto('/capacity');
  await page.getByLabel('입력 JSON 불러오기').setInputFiles({name:'isolated-capacity-input.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(capacityScaleFixture()))});
  const panel=page.getByTestId('capacity-study-panel');await expect(panel).toContainText('1277');
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/capacity-studies')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='saveBaseline');
  await panel.getByRole('button',{name:'기준 자원 고정·저장',exact:true}).click();
  const saved=await savedResponse;expect(saved.status(),await saved.text()).toBe(200);baselineId=(await saved.json()).item.id;
  const comparisonResponse=page.waitForResponse(r=>r.url().endsWith('/api/capacity-studies')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='compare',{timeout:95000});
  await panel.getByRole('button',{name:'대안 비교',exact:true}).click();
  const response=await comparisonResponse;expect(response.status(),await response.text()).toBe(200);const result=await response.json();
  for(const r of result.results){expect(['COMPLETE','PARTIAL']).toContain(r.status);expect(r.calculation.taskCount).toBe(1277);expect(r.calculation.largestComponent).toBeLessThanOrEqual(600);expect(r.assignments.length+r.metrics.requiredUnassigned+r.metrics.conditionalUnassigned).toBe(1277);expect(r.approvalEligible).toBe(false)}
  await expect(panel.getByTestId('capacity-calculation-summary')).toHaveCount(2);await expect(panel.getByTestId('capacity-calculation-summary').first()).toContainText('1,277');
  await panel.locator('section').last().screenshot({path:path+'/comparison-ko.png'});
  await page.reload();await panel.getByRole('combobox',{name:/저장본/}).selectOption(baselineId);await expect(panel.getByTestId('capacity-calculation-summary')).toHaveCount(2);
  await page.getByLabel('언어 / Language').selectOption('en');await expect(panel.getByTestId('capacity-calculation-summary').first()).toContainText('Independent groups');
  await panel.locator('section').last().screenshot({path:path+'/comparison-en.png'});
  expect(errors).toEqual([]);expect(await operational()).toBe(before);
  writeFileSync(path+'/browser-result.json',JSON.stringify({checkedAt:new Date().toISOString(),basis:'SYNTHETIC_INPUT_REAL_HTTP_API_POSTGRESQL',reloadVerified:true,languages:['ko','en'],operationalRecordsUnchanged:true,results:result.results.map((r:any)=>({id:r.id,status:r.status,assigned:r.assignments.length,metrics:r.metrics,calculation:r.calculation,approvalEligible:r.approvalEligible}))},null,2));
 }finally{if(baselineId)await db.workRecord.deleteMany({where:{workspace:'capacity-study:demo',OR:[{id:baselineId},{id:{startsWith:baselineId+':'}},{kind:'comparison',payload:{path:['baselineId'],equals:baselineId}}]}})}
});
