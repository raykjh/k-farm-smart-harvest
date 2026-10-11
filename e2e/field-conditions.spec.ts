import {test,expect} from './authenticated-test';
test('condition entry changes ranking without saving or manufacturing source facts',async({page})=>{
 await page.goto('/register');
 await page.getByLabel('이름',{exact:true}).fill('테스트 농부');await page.getByLabel('생년월일').fill('1960-01-01');await page.getByLabel('연락처',{exact:true}).fill('000-0000-0000');
 await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByRole('button',{name:'농지 추가',exact:true}).click();await page.getByLabel('작업 면적',{exact:false}).fill('1000');
 await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByText('농지·지역 조건 확인 및 추천 근거',{exact:true}).click();
 await page.getByRole('combobox',{name:'현 이용형태',exact:true}).selectOption('upland');await page.getByRole('combobox',{name:'용수 확보',exact:true}).selectOption('yes');await page.getByRole('combobox',{name:'배수',exact:true}).selectOption('good');await page.getByRole('combobox',{name:'작업 장비 진입',exact:true}).selectOption('no');await page.getByRole('combobox',{name:'필수 인력 확보',exact:true}).selectOption('yes');
 await page.getByLabel('검토 지역',{exact:true}).fill('계북면');await page.getByRole('combobox',{name:'봄감자 · 지역·품종 적합성 검토',exact:true}).selectOption('suitable');await page.getByRole('combobox',{name:'노지고추 · 지역·품종 적합성 검토',exact:true}).selectOption('suitable');await page.getByLabel('확인일',{exact:true}).fill('2026-09-18');
 await expect(page.locator('.crop-choice').filter({hasText:'고추'})).toContainText('산정 대기');await page.getByLabel('출처·품종·현장 확인자 및 근거',{exact:true}).fill('가상 검증 입력 / 실제 현장정보 아님');
 await expect(page.locator('.crop-choice').first()).toContainText('고추');await expect(page.locator('.crop-choice').first()).toContainText('90/100');
 await page.getByRole('button',{name:'임시 저장',exact:true}).click();await page.reload();await page.getByRole('button',{name:'초안 불러오기'}).click();await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByRole('button',{name:'다음',exact:true}).click();await expect(page.locator('.crop-choice').first()).toContainText('90/100');
 await page.screenshot({path:'test-results/field-conditions.png',fullPage:true});
});
