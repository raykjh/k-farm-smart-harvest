import {test,expect} from './authenticated-test';
import {nextEquipmentCode} from '../lib/equipment-code';
test('live saved workspace opens each new section without business mutations',async({page,request})=>{
 const before=await(await request.get('/api/workspace')).json(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async r=>{if(r.request().method()!=='GET'){errors.push('Unexpected mutation '+r.request().url());await r.abort()}else await r.continue()});
 await page.goto('/');await expect(page.getByRole('heading',{name:'지원현황',exact:true})).toBeVisible();
 for(const name of ['일정표','장비현황','농지','생산관리','인력관리','데모','농부 화면','실적·통계']){await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await expect(page.getByRole('heading',{name,exact:true}).first()).toBeVisible();}
 await page.getByRole('navigation').getByRole('button',{name:'장비현황',exact:true}).click();
 await page.getByRole('button',{name:/장비등록/}).click();
 await expect(page.getByLabel('장비코드',{exact:true})).toHaveValue(nextEquipmentCode(before.state,'DR'));
 await page.getByLabel('장비 종류',{exact:true}).selectOption('TV');
 await expect(page.getByLabel('장비코드',{exact:true})).toHaveValue(nextEquipmentCode(before.state,'TV'));
 await expect(page.getByLabel('시간당 작업면적 (ha/시간)',{exact:true})).toHaveCount(0);
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'생산관리',exact:true}).click();await page.getByRole('button',{name:'작물 기준자료',exact:true}).click();await expect(page.getByRole('heading',{name:'작물 기준자료',exact:true})).toBeVisible();
 expect(errors).toEqual([]);expect((await(await request.get('/api/workspace')).json()).state).toEqual(before.state);
});
