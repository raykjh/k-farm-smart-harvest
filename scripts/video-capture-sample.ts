import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect,type APIResponse} from '@playwright/test';

const folder=resolve('.data/video-capture-20261018');
const credentials=JSON.parse(await readFile(resolve(folder,'credentials.json'),'utf8'));
const origin=credentials.origin;
assert.equal(origin,'https://127.0.0.1:3101');
const browser=await chromium.launch({headless:true});
const report:any={at:new Date().toISOString(),origin,viewport:{width:1920,height:1080},accounts:[],errors:[],scope:'No paid inference, registration submission or external messaging'};
try{
 if(process.argv.includes('--probe')){
  for(const account of credentials.accounts){
   const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1,ignoreHTTPSErrors:true});
   const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
   await page.goto(origin+'/login');
   await page.getByRole('textbox',{name:'아이디',exact:true}).fill(account.username);
   await page.getByLabel('비밀번호',{exact:true}).fill(account.password);
   await page.getByRole('button',{name:'로그인',exact:true}).click();
   await page.waitForURL(url=>url.pathname===(account.role==='SUPER_ADMIN'?'/accounts':'/'));
   if(account.centerId){
    await page.getByTestId('workspace-status').waitFor();
    const response:APIResponse=await page.request.get(origin+'/api/workspace');assert(response.ok());
    const body:any=await response.json();assert.equal(body.state.ruleVersion,'VIDEO_RECORDING_20261018');
    assert.equal(body.state.centerSharing.centerId,account.centerId);assert.equal(body.state.fields.length,0);assert.equal(body.state.missions.length,0);
    report.accounts.push({username:account.username,center:account.centerId,login:true,fields:0,tasks:0,machines:body.state.machines.length});
    if(account.centerId==='demo'){
     await context.storageState({path:resolve(folder,'gyebuk-session.json')});
     await page.goto(origin+'/?tab=fields');await page.getByTestId('workspace-status').waitFor();
     report.fieldScreen={text:(await page.locator('body').innerText()).slice(0,4000),buttons:await page.getByRole('button').allTextContents()};
     await page.screenshot({path:resolve(folder,'probe-fields.png')});
    }
   }else report.accounts.push({username:account.username,login:true,role:account.role});
   await context.close();
  }
  assert.equal(report.errors.length,0);await writeFile(resolve(folder,'screen-probe.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }else{
  assert(process.argv.includes('--record'),'Choose --probe or --record');
  await mkdir(resolve(folder,'raw-video'));
  const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1,ignoreHTTPSErrors:true,storageState:resolve(folder,'gyebuk-session.json'),recordVideo:{dir:resolve(folder,'raw-video'),size:report.viewport}});
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  const start=Date.now();
  await page.goto(origin+'/?tab=fields');await page.getByTestId('workspace-status').waitFor();
  assert(!page.url().includes('/login'));
  await page.waitForTimeout(1200);
  report.sampleStartsAfter=(Date.now()-start)/1000;
  await page.screenshot({path:resolve(folder,'sample-fields.png')});
  await page.waitForTimeout(2500);
  const register=page.getByRole('button',{name:/신규 농지 등록/});
  await expect(register).toBeVisible();await register.click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await page.waitForTimeout(500);
  report.modal={rect:await dialog.boundingBox(),text:(await dialog.innerText()).slice(0,1000)};
  await page.screenshot({path:resolve(folder,'sample-registration.png')});
  await page.waitForTimeout(7500);
  await page.keyboard.press('Escape');
  // Navigate without saving the blank application; no applicant or farm is created.
  await page.goto(origin+'/?tab=equipment');await page.getByTestId('workspace-status').waitFor();
  await page.waitForTimeout(1200);await page.screenshot({path:resolve(folder,'sample-equipment.png')});
  await page.waitForTimeout(7000);
  report.overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  report.rawVideo=await page.video()!.path();
  await context.close();
  assert.equal(report.errors.length,0);assert.equal(report.overflow,false);
  await writeFile(resolve(folder,'capture.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}finally{await browser.close();}
