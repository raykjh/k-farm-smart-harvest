import {test,expect} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {seedProductionCropReview,productionCropRegistration} from '../scripts/fixtures/production-crop-review';
import {aiBudgetDb} from '../lib/ai-budget-ledger';

const enabled=process.env.KFARM_CROP_AI_E2E==='1',live=process.env.KFARM_LIVE_AI_E2E==='1';
const folder='.data/validation/20261011-crop-ai-compound';
const runId=process.env.KFARM_LIVE_RUN_ID;
const reportName=live?`crop-live-${runId}`:'crop-offline';
test.skip(!enabled,'Explicit disposable-DB run required');
test.beforeAll(async()=>{
 if(process.env.DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e')throw Error('Disposable crop-review DB only');
 if(live){
  if(process.env.AI_BUDGET_DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm')throw Error('Shared operating cost ledger required');
  if(!runId||!/^[a-z0-9-]{1,60}$/.test(runId))throw Error('Explicit unique live run ID required; previous runs are never overwritten');
  await mkdir(folder,{recursive:true});await writeFile(`${folder}/${reportName}.started`,new Date().toISOString(),{flag:'wx'});
 }
 await db.$transaction(tx=>seedProductionCropReview(tx),{timeout:60000});
});

test('new intake uses real API and DB; explicit crop review either verifies AI or blocks until deliberate rule review',async({page,context},info)=>{
 test.setTimeout(180000);
 const token=randomBytes(32).toString('hex'),id=randomUUID(),errors:string[]=[],requests:any[]=[];
 const report:any={mode:live?'LIVE_NEBIUS':'NO_PAID_INFERENCE',businessResponsesReplaced:false,actualSms:false,equipmentCommands:false,steps:[]};
 await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:'crop-review-'+id,name:'격리 검증 담당자',role:'CENTER_ADMIN',centerId:'demo',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
 await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});
 await context.addCookies([{name:'kfarm_session',value:token,domain:'127.0.0.1',path:'/'}]);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/continuous-production')&&r.method()==='POST')requests.push(r.postDataJSON())});
 const post=async(path:string,data:unknown)=>page.request.post(path,{data,headers:{origin:'http://127.0.0.1:3100'}});
 const get=async()=>{const r=await page.request.get('/api/continuous-production');expect(r.ok()).toBe(true);return r.json()};
 const callsBefore=await aiBudgetDb().aiCall.count();
 try{
  const state=await (await page.request.get('/api/workspace')).json();expect(state.state.ruleVersion).toBe('CROP_AI_ISOLATED');
  const registration=productionCropRegistration(),saved=await post('/api/registrations',registration);expect(saved.ok(),await saved.text()).toBe(true);
  const initial=(await get()).view;expect(initial.items[0].candidateFacts).toHaveLength(2);expect(initial.items[0].decision.source).toBe('RULES');
  const staffId=randomUUID(),staffToken=randomBytes(32).toString('hex');
  await db.workRecord.create({data:{...authKey('user',staffId),payload:{id:staffId,username:staffId,name:'권한 검증',role:'CENTER_STAFF',centerId:'demo',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
  await db.workRecord.create({data:{...authKey('session',digest(staffToken)),payload:{userId:staffId,expiresAt:Date.now()+3600000}}});
  const denied=await page.request.post('/api/continuous-production',{headers:{origin:'http://127.0.0.1:3100',cookie:'kfarm_session='+staffToken},data:{action:'ai-review',requestId:randomUUID(),fingerprint:initial.fingerprint,pnu:initial.items[0].pnu,priority:'BALANCED'}});expect(denied.status()).toBe(403);
  await page.setViewportSize({width:1440,height:1050});await page.goto('/?tab=production');
  const panel=page.getByTestId('continuous-production');await expect(panel.getByRole('button',{name:'AI 작물 검토',exact:true})).toBeVisible();
  await expect(panel.getByTestId('crop-ai-review')).toContainText('계산 기준 추천');expect(await aiBudgetDb().aiCall.count()).toBe(callsBefore);
  await panel.getByLabel('작물 판단 우선순위',{exact:true}).selectOption('MIN_LABOR');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/continuous-production')&&r.request().method()==='POST'&&r.request().postDataJSON().action==='ai-review');
  await panel.getByRole('button',{name:'AI 작물 검토',exact:true}).click();const reviewed=await response,body=await reviewed.json();
  if(live){
   expect(reviewed.ok(),JSON.stringify(body)).toBe(true);expect(body.view.items[0].decision.source).toBe('NEBIUS');expect(body.view.items[0].proposal.cultivation.crop).toBe('potato');
   expect(body.view.items[0].decision.rationaleCheck.status).toBe('VERIFIED');report.decision=body.view.items[0].decision;
   await expect(panel.getByTestId('crop-ai-review')).toContainText('AI 검토 완료');
   const retry=await post('/api/continuous-production',requests.find(r=>r.action==='ai-review'));expect((await retry.json()).alreadyReviewed).toBe(true);
   expect(await aiBudgetDb().aiCall.count()).toBe(callsBefore+1);
   await panel.getByText('AI 선택·탈락 근거',{exact:true}).click();
  }else{
   expect(reviewed.status()).toBe(409);expect(body.error).toContain('OPERATOR_REVIEW');await expect(panel).toContainText('유료 AI 연결');
   report.steps.push('Unavailable AI recorded as OPERATOR_REVIEW; no hidden success');
   await panel.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();await panel.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
   await expect(panel.getByRole('button',{name:'선택 1필지 계획 일괄 확정'})).toBeDisabled();
   await page.screenshot({path:info.outputPath('crop-ai-review-blocked.png'),fullPage:true});
   await panel.getByRole('button',{name:'AI 판단을 해제하고 계산 기준으로 다시 검토',exact:true}).click();await expect(panel).not.toContainText('OPERATOR_REVIEW');
  }
  const fingerprint=(await get()).view.fingerprint;
  await panel.getByRole('button',{name:'새로고침',exact:true}).click();expect((await get()).view.fingerprint).toBe(fingerprint);
  await page.screenshot({path:info.outputPath('crop-review-before-approval.png'),fullPage:true});
  await panel.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();await panel.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
  await panel.getByRole('button',{name:'선택 1필지 계획 일괄 확정'}).click();await expect(panel).toContainText('다음 재배 연결됨');
  const records=await db.workRecord.findMany({where:{workspace:'sandbox',kind:{in:['cultivation','annualReservation','laborDemand','productionApproval']}}});
  expect(records.filter(r=>r.kind==='cultivation')).toHaveLength(1);expect(records.filter(r=>r.kind==='annualReservation').length).toBeGreaterThan(0);expect(records.filter(r=>r.kind==='laborDemand').length).toBeGreaterThan(0);
  expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation'}})).toBeGreaterThan(0);
  expect(await db.outbox.count({where:{centerId:'demo',status:'PENDING'}})).toBe(1);expect(await db.outbox.count({where:{centerId:'demo',status:'SENT'}})).toBe(0);
  expect(await aiBudgetDb().aiCall.count()).toBe(callsBefore+(live?1:0));
  report.steps.push('Real registration -> crop proposal -> review -> approval -> common reservations and labor demand -> pending notice');
  report.approval=(records.find(r=>r.kind==='productionApproval')?.payload as any)?.decisions;
  await page.locator('.language-selector select').selectOption('en');await expect(page.getByRole('heading',{name:'Production by field',exact:true})).toBeVisible();
  await page.setViewportSize({width:430,height:932});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('crop-review-approved-mobile.png'),fullPage:true});expect(errors).toEqual([]);report.status='PASS';
 }finally{
  report.calls=await aiBudgetDb().aiCall.count()-callsBefore;report.pageErrors=errors;report.finishedAt=new Date().toISOString();
  await mkdir(folder,{recursive:true});await writeFile(`${folder}/${reportName}-ui.json`,JSON.stringify(report,null,2),live?{flag:'wx'}:undefined);
  await db.workRecord.deleteMany({where:{workspace:'auth',kind:'session',payload:{path:['userId'],equals:id}}});
 }
});
