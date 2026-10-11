import {test,expect} from './authenticated-test';
test('operator completes the full workflow and farmer sees updated schedule',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'함께 가꾸는 농사, 한눈에.'})).toBeVisible();
 await page.getByRole('button',{name:'농지 등록·추천',exact:true}).click();
 await page.getByRole('button',{name:'농지 등록 · 추천 확인',exact:true}).click();await expect(page.getByRole('status')).toContainText('농지 정보를 등록');
 await page.getByRole('button',{name:'작물 선택 저장',exact:true}).click();await expect(page.getByRole('status')).toContainText('작물·참여형태');
 await page.getByRole('button',{name:'연간계획·배차 생성',exact:true}).click();await expect(page.getByRole('status')).toContainText('연간계획');
 await page.getByRole('button',{name:'오늘',exact:true}).click();await page.getByRole('button',{name:'강풍 이벤트 발생'}).click();await expect(page.getByRole('status')).toContainText('강풍 이벤트');
 await page.getByRole('button',{name:'AI 재계획 실행'}).click();await expect(page.getByTestId('revision-panel')).toContainText('일괄 승인 대기');
 await expect(page.getByTestId('revision-panel')).toContainText('모의 자료 기준:');
 await expect(page.getByTestId('revision-panel')).toContainText('장비 실행·농부 알림 발송은 하지 않았습니다.');
 await expect(page.getByTestId('revision-panel')).not.toContainText('27시간');
 await page.getByRole('button',{name:/건 변경계획 일괄 승인/}).click();await expect(page.getByTestId('revision-panel')).toContainText('적용 완료');
 await page.getByRole('button',{name:'대기 알림 모의 발송',exact:true}).click();await expect(page.getByRole('status')).toContainText('모의 알림');
 await page.getByRole('button',{name:'농부 화면 열기'}).click();await expect(page.getByText('새 일정 안내 · v2')).toBeVisible();await expect(page.getByText(/직접 장비에 접근하지/)).toBeVisible();
 await page.screenshot({path:'test-results/farmer.png',fullPage:true});await page.getByRole('button',{name:'센터 화면'}).click();await page.screenshot({path:'test-results/dashboard.png',fullPage:true});
});
