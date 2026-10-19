import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {fieldManagementFixture} from '../tests/field-management-fixture';
import type {State} from '../lib/types';
test.use({authRole:'CENTER_STAFF'});

test('field management keeps owner, field conditions, pending crop and work history in one popup',async({page},info)=>{
 const f=await fieldManagementFixture(),calls=await db.aiCall.count();
 try{
  await page.goto('/?tab=fields');const row=page.getByTestId('managed-field-'+f.field.pnu);
  await expect(row).toContainText('작물 선택 대기');await expect(row.getByRole('button')).toHaveCount(1);
  await row.getByRole('button',{name:'관리',exact:true}).click();const modal=page.getByRole('dialog',{name:'농지 관리',exact:true});
  await expect(modal.getByRole('tab')).toHaveCount(4);await expect(modal.getByRole('tabpanel')).toContainText('홍가상');await expect(modal.getByRole('tabpanel')).toContainText('1960-01-01');await expect(modal.getByRole('tabpanel')).toContainText('000-0000-0000');
  await page.screenshot({path:info.outputPath('field-owner.png')});
  await modal.getByRole('tab',{name:'농지 정보',exact:true}).click();await expect(modal.getByRole('tabpanel')).toContainText('1,000 m²');
  await modal.getByLabel(f.field.address+' 장비 진입',{exact:true}).selectOption('no');await modal.getByRole('button',{name:'저장',exact:true}).click();await expect(modal.getByRole('button',{name:'저장',exact:true})).toHaveCount(0);
  await modal.getByLabel(f.field.address+' 장비 진입',{exact:true}).selectOption('yes');await modal.getByRole('button',{name:'저장',exact:true}).click();await expect(modal.getByRole('button',{name:'저장',exact:true})).toHaveCount(0);
  await modal.getByRole('tab',{name:'작업 이력',exact:true}).click();await expect(modal).toContainText('작업 이력이 없습니다.');
  await modal.getByRole('tab',{name:'작물·생산',exact:true}).click();await expect(modal.getByRole('button',{name:'작물 선택·일정 등록',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await page.reload();await expect(row).toContainText('작물 선택 대기');expect(await db.workRecord.count({where:{kind:'cultivation'}})).toBe(0);
  await row.getByRole('button',{name:'관리',exact:true}).click();await modal.getByRole('tab',{name:'작업 이력',exact:true}).click();await expect(modal).toContainText('작업 이력이 없습니다.');await modal.getByRole('tab',{name:'작물·생산',exact:true}).click();
  await modal.getByRole('combobox',{name:'작물',exact:true}).selectOption('soybean');await modal.getByLabel('재배 시작',{exact:true}).fill('2034-01-01');await modal.getByLabel('정리 완료 예정',{exact:true}).fill('2034-12-31');
  await modal.getByLabel('작기 시작 연도',{exact:true}).fill('2034');await modal.getByRole('button',{name:'공통 작업 기준 적용',exact:true}).click();
  await modal.getByRole('button',{name:'작물 선택·일정 등록',exact:true}).click();await expect(modal.getByRole('status')).toContainText('작물과 일정을 저장했습니다.');
  await expect(modal.getByRole('combobox',{name:'변경 작물',exact:true})).toHaveValue('soybean');await page.screenshot({path:info.outputPath('field-crop.png')});
  const state=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;expect(state.fields[0].crop).toBe('콩');expect(state.missions.length).toBeGreaterThan(3);
  await modal.getByRole('tab',{name:'작업 이력',exact:true}).click();await expect(modal.getByTestId('field-work-history').locator('tbody tr')).toHaveCount(state.missions.length);
  await modal.getByRole('tab',{name:'작물·생산',exact:true}).click();await modal.getByRole('combobox',{name:'변경 작물',exact:true}).selectOption('sesame');
  await modal.getByText('대체 작물 작업 기준 보완',{exact:true}).click();await modal.getByLabel('작기 시작 연도',{exact:true}).fill('2034');await modal.getByRole('button',{name:'공통 작업 기준 적용',exact:true}).click();
  await modal.getByRole('button',{name:'변경 영향·재계획 계산',exact:true}).click();await expect(modal.getByRole('button',{name:'변경계획 일괄 승인',exact:true})).toBeDisabled();
  await modal.getByLabel('비용 검토 기록',{exact:true}).fill('위탁 범위 내 검토');await modal.getByLabel('소유주 동의·위임 근거',{exact:true}).fill('위임 범위 내 작물 변경');
  page.once('dialog',dialog=>dialog.accept());await modal.getByRole('button',{name:'변경계획 일괄 승인',exact:true}).click();await expect(modal.getByRole('status').filter({hasText:'변경계획을 승인했습니다.'})).toBeVisible();
  await page.keyboard.press('Escape');await page.reload();await expect(row).not.toContainText('작물 선택 대기');await expect(row).toContainText('참깨');
  expect(await db.aiCall.count()).toBe(calls);
 }finally{await f.cleanup()}
});
