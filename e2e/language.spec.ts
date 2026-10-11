import {test,expect} from './authenticated-test';
test('Korean default, English persistence, all views and unchanged domain data',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');const before=await (await page.request.get('/api/demo')).json();
 await expect(page.getByRole('heading',{name:'함께 가꾸는 농사, 한눈에.'})).toBeVisible();
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(page.getByRole('heading',{name:'Shared farming, at a glance.'})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('lang','en');await page.reload();
 await expect(page.getByRole('heading',{name:'Shared farming, at a glance.'})).toBeVisible();
 await page.screenshot({path:'test-results/english-dashboard.png'});
 for(const view of ['Today','Calendar','Equipment','Fields & farmers','Farmer view']){
  await page.getByRole('navigation').getByRole('button',{name:view,exact:true}).click();
  const remaining=await page.evaluate(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const found:string[]=[];let n;while(n=walker.nextNode()){const p=n.parentElement;if(p&&!p.closest('.language-selector,script,style')&&/[가-힣]/.test(n.textContent??'')&&p.getClientRects().length)found.push(n.textContent!.trim())}return found});
  expect(remaining,`Untranslated interface text in ${view}`).toEqual([]);
  if(view==='Fields & farmers'){
   await expect(page.getByLabel('A crop')).toHaveValue('쌀');
   await expect(page.getByLabel('A crop').getByRole('option',{name:'Rice'})).toHaveAttribute('value','쌀');
  }
 }
 await page.getByRole('button',{name:"This year's farming plan"}).click();await expect(page.getByText('Rice · Shared participation')).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/english-farmer.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByLabel('언어 / Language').selectOption('ko');await expect(page.getByRole('button',{name:'알림 보기'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'함께 가꾸는 농사, 한눈에.'})).toBeVisible();
 expect((await (await page.request.get('/api/demo')).json()).state).toEqual(before.state);expect(errors).toEqual([]);
});
