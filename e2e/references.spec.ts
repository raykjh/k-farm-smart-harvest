import {test,expect} from './authenticated-test';
test('stored references show sources, unknown thresholds, bilingual UI and no state mutation',async({page})=>{
 const before=await (await page.request.get('/api/demo')).json();
 const catalog=await (await page.request.get('/api/crop-reference')).json();
 expect(catalog.references).toHaveLength(3);expect(catalog.supplyPenaltyEnabled).toBe(false);
 await page.goto('/references');
 await expect(page.getByRole('heading',{name:'작물 기준자료',exact:true})).toBeVisible();
 await expect(page.getByText('수급 기준 미확보 · 감점 미적용',{exact:true})).toHaveCount(3);
 await expect(page.getByRole('link',{name:'공식 생산 통계 원문'})).toHaveCount(3);
 await page.screenshot({path:'test-results/crop-references-ko.png',fullPage:true});
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(page.getByRole('heading',{name:'Crop reference data',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/crop-references-en-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const remaining=await page.evaluate(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const a:string[]=[];let n;while(n=w.nextNode())if(n.parentElement&&!n.parentElement.closest('.language-selector,script,style')&&/[가-힣]/.test(n.textContent??'')&&n.parentElement.getClientRects().length)a.push(n.textContent??'');return a});
 expect(remaining).toEqual([]);
 expect((await (await page.request.get('/api/demo')).json()).state).toEqual(before.state);
});
