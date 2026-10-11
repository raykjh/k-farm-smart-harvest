import {test,expect} from './authenticated-test';
test('volunteers apply before staff confirms allocation',async({page})=>{
 await page.goto('/labor');
 for(const [name,distance] of [['Far','5'],['Near','1']]){
  await page.getByLabel('이름 또는 내부 식별명').fill(name);
  await page.getByLabel('작업 농지까지 거리').fill(distance);
  await page.getByRole('button',{name:'희망자 추가'}).click();
 }
 await page.getByLabel('작업일',{exact:true}).fill('2027-06-16');
 await page.getByLabel('농지·작업 내용').fill('시연 농지 제초');
 await page.getByLabel('작업시간 안내').fill('09:00–12:00');
 await page.getByLabel('보수 안내').fill('시연용 보수');
 await page.getByLabel('필요 인원').fill('1');
 await page.getByRole('button',{name:'모집 안내 작성'}).click();
 await page.getByLabel('Far eligibility').check();
 await page.getByLabel('Near eligibility').check();
 await page.getByLabel('Far response').selectOption('APP');
 await page.getByLabel('Near response').selectOption('PHONE');
 await expect(page.getByRole('cell',{name:'미확정',exact:true})).toHaveCount(2);
 await page.getByRole('button',{name:'담당자 일괄 확정'}).click();
 await expect(page.getByRole('row').filter({hasText:'Near'})).toContainText('배정 확정');
 await expect(page.getByRole('row').filter({hasText:'Far'})).toContainText('대기');
 await page.getByLabel('Near response').selectOption('NONE');
 await expect(page.getByRole('cell',{name:'미확정',exact:true})).toHaveCount(2);
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(page.getByRole('heading',{name:'Labor management',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('row')).toHaveCount(1);
});
