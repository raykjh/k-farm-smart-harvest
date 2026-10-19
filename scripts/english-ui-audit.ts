import {chromium,type Page} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.data/english-review-20261018'),origin='https://127.0.0.1:3101';
const revision=process.argv.find(x=>x.startsWith('--revision='))?.slice(11)??'initial';
const dir=resolve(root,revision);await mkdir(dir,{recursive:true});
const accounts=JSON.parse(await readFile('.data/video-capture-20261018/credentials.json','utf8')).accounts;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080},ignoreHTTPSErrors:true,locale:'en-US'});
// tsx preserves nested callback names in evaluated test functions.
await context.addInitScript("window.__name=(fn)=>fn;if(!localStorage.getItem('kfarm.locale'))localStorage.setItem('kfarm.locale','en')");
const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const views:any[]=[];let sequence=0;
async function snapshot(name:string){
 await page.waitForTimeout(650);
 const data=await page.evaluate(()=>{
  const visible=(e:Element)=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('script,style,.language-selector');
  const strings:any[]=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n:Node|null;
  while(n=w.nextNode()){const p=n.parentElement,s=n.textContent?.trim();if(p&&s&&/[가-힣]/.test(s)&&visible(p))strings.push({text:s,tag:p.tagName,context:p.parentElement?.getAttribute('class')??''});}
  const attrs=Array.from(document.querySelectorAll('[aria-label],[placeholder],[title]')).filter(visible).flatMap(e=>['aria-label','placeholder','title'].filter(a=>/[가-힣]/.test(e.getAttribute(a)??'')).map(a=>({text:e.getAttribute(a),attribute:a,tag:e.tagName})));
  return {lang:document.documentElement.lang,strings:[...new Map(strings.map(x=>[x.text,x])).values()],attrs,buttons:Array.from(document.querySelectorAll('button,[role=tab],summary')).filter(visible).map(e=>e.textContent?.trim()).filter(Boolean),horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
 });
 views.push({name,url:page.url(),...data});await page.screenshot({path:resolve(dir,String(++sequence).padStart(3,'0')+'-'+name+'.png')});
 await writeFile(resolve(dir,'audit.json'),JSON.stringify({views,errors},null,2));console.log(JSON.stringify({name,remaining:data.strings.length,attributes:data.attrs.length,overflow:data.horizontalOverflow}));
}
async function go(path:string,name:string){await page.goto(origin+path);await page.waitForLoadState('networkidle',{timeout:20000}).catch(()=>{});await snapshot(name);}
async function click(name:string,role:'button'|'tab'='button',scope=page.locator('body')){const b=scope.getByRole(role,{name,exact:true});if(await b.count()){await b.first().click();return true;}return false;}
async function login(admin=false){const a=accounts.find((a:any)=>admin?a.role==='SUPER_ADMIN':a.centerId==='demo');await page.goto(origin+'/login');const response=await context.request.post(origin+'/api/auth',{headers:{Origin:origin},data:{action:'login',username:a.username,password:a.password,remember:false}});assert.equal(response.status(),200);}
try {
 await go('/login','login');await click('Sign up');if(await page.getByRole('dialog').count())await snapshot('signup');
 await page.goto(origin+'/login');await page.waitForFunction(()=>document.documentElement.lang==='en');if(await click('Forgot password')){await snapshot('recovery');await page.locator('.login-recovery summary').click();await snapshot('admin-recovery');}
 await login();
 for(const [path,name] of [['/','home'],['/?tab=equipment','equipment'],['/?tab=fields','fields'],['/?tab=schedule','schedule'],['/?tab=labor','labor'],['/?tab=reports','reports'],['/?tab=settings','settings'],['/crop-info','crop-info'],['/equipment-info','equipment-info'],['/temperature-info','temperature'],['/reservations','reservations'],['/crop-standards','crop-standards'],['/references','references'],['/capacity','capacity'],['/regions','regions']])await go(path,name);
 await go('/?tab=fields','field-actions');
 if(await click('AI planning / batch approval')){await snapshot('ai-crop-mix');for(const label of ['Resource proposal','Comparison'])if(await click(label,'tab'))await snapshot('ai-'+label.replaceAll(' ','-'));}
 await page.goto(origin+'/?tab=fields');await page.getByTestId('workspace-status').waitFor();
 await page.locator('[data-testid^="managed-field-"]').first().getByRole('button',{name:'Manage',exact:true}).click();
 for(const label of ['Owner','Field details','Crop / production','Work history']){await click(label,'tab');await snapshot('field-'+label.replaceAll(/[^a-zA-Z]/g,'-'));}
 await page.goto(origin+'/?tab=equipment');await page.getByTestId('workspace-status').waitFor();
 if(await click('Details')){await snapshot('equipment-details');if(await click('Edit'))await snapshot('equipment-edit');}
 await page.goto(origin+'/?tab=equipment');await page.getByTestId('workspace-status').waitFor();if(await click('＋ Register equipment'))await snapshot('equipment-register');
 await page.goto(origin+'/?tab=schedule');await page.getByLabel('Schedule year',{exact:true}).selectOption('2027');await page.getByLabel('Schedule month',{exact:true}).getByRole('button',{name:'10',exact:true}).click();
 const day=page.locator('.schedule-day').first();await day.locator('summary').click();await snapshot('schedule-expanded');await day.getByRole('button',{name:'Manage',exact:true}).first().click();
 for(const label of ['Reschedule','Record result','Cancel task','Task history','Work order']){if(await click(label))await snapshot('task-'+label.replaceAll(' ','-'));}
 await click('Reschedule');await page.getByLabel('Select a reason',{exact:true}).selectOption('장비 문제');await snapshot('task-breakdown');
 for(const tab of ['cultivations','references','capacity'])await go('/crop-info?tab='+tab,'crop-'+tab);
 await page.goto(origin+'/crop-info');await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});
 const sections=await page.locator('[aria-label="Crop sections"] button').allTextContents();for(const label of sections){await click(label);await snapshot('crop-'+label.replaceAll(/[^a-zA-Z]/g,'-'));}
 await page.goto(origin+'/equipment-info');await page.getByRole('button',{name:'Model specifications',exact:true}).waitFor();assert(await click('Model specifications'));await snapshot('equipment-models');
 await page.goto(origin+'/?tab=labor');await page.getByTestId('workspace-status').waitFor();
 if(await click('Manage')){await snapshot('labor-permanent');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();}
 if(await click('＋ Add')){await snapshot('labor-register');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();}
 if(await click('Edit')){await snapshot('labor-edit');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();}
 await page.getByTestId('regular-workers').getByRole('button',{name:/^Schedule/}).first().click();await snapshot('labor-employee-schedule');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 for(let month=0;month<12&&await page.locator('.labor-calendar-section .day:not([disabled])').count()===0;month++){await page.getByRole('button',{name:'Next month',exact:true}).click();await page.waitForTimeout(150);}
 const availableDay=page.locator('.labor-calendar-section .day:not([disabled])').first();assert(await availableDay.count(),'No labor demand date available for attendance review');await availableDay.click();await snapshot('labor-attendance');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 if(await click('Text messages','tab'))await snapshot('labor-sms');
 await page.goto(origin+'/?tab=reports');await page.getByTestId('workspace-status').waitFor();if(await click('Actuals','tab'))await snapshot('reports-actuals');
 for(const label of ['Change password','Edit my profile','Request password recovery']){await page.goto(origin+'/?tab=settings');await page.getByTestId('workspace-status').waitFor();assert(await click(label),'Missing settings action '+label);await snapshot('settings-'+label.replaceAll(/[^a-zA-Z]/g,'-'));}
 await page.goto(origin+'/?tab=fields');await page.getByTestId('workspace-status').waitFor();await click('＋ Register new field');await snapshot('registration-dialog');
 const intake=page.getByTestId('field-registration');await intake.getByLabel('Name',{exact:true}).fill('홍길동');await intake.getByLabel('Date of birth',{exact:true}).fill('19600101');await intake.getByLabel('Address',{exact:true}).fill('전북특별자치도 장수군 계북면');await intake.getByLabel('Phone',{exact:true}).fill('00000000001');await intake.getByRole('button',{name:'Next',exact:true}).click();await intake.getByRole('button',{name:'Look up owned fields',exact:true}).click();await snapshot('registration-parcels');
 await go('/register','registration');
 await login(true);await go('/accounts','admin-accounts');if(await click('Details'))await snapshot('account-details');await go('/crop-standards','admin-crop-standards');await go('/regions','admin-regions');
 // Presentation-only locale change must preserve language after reload.
 await page.getByLabel('언어 / Language',{exact:true}).selectOption('ko');await page.reload();await page.waitForFunction(()=>document.documentElement.lang==='ko');await page.getByLabel('언어 / Language',{exact:true}).selectOption('en');await page.reload();await page.waitForFunction(()=>document.documentElement.lang==='en');
} catch(e){errors.push(e instanceof Error?e.message:String(e));console.error(errors.at(-1));await snapshot('audit-error');process.exitCode=1;}
finally{await writeFile(resolve(dir,'audit.json'),JSON.stringify({views,errors},null,2));await context.close();await browser.close();}
