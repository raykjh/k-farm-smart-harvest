import {test,expect} from './authenticated-test';
test('completion and snapshot controls send explicit confirmation without live writes',async({page})=>{
 const requests:any[]=[];
 await page.route('**/api/work-reports',r=>r.fulfill({json:{schemaVersion:'work-report-v1',hash:'a'.repeat(64),asOf:'2026-09-20',planVersion:7,rows:[{missionId:'m',fieldId:'f',task:'작업',crop:'쌀',plannedDate:'2026-01-01',source:'SIMULATED',status:'PLANNED',confirmed:false,evidenceId:null}]}}));
 await page.route('**/api/execution-records',r=>{if(r.request().method()==='POST'){requests.push(r.request().postDataJSON());return r.fulfill({status:409,json:{error:'테스트: 저장하지 않음'}})}return r.fulfill({json:{history:[],snapshots:[]}})});
 await page.goto('/reports');await expect(page.getByLabel('확인 담당자')).toHaveValue(/테스트 담당자/);
 await page.getByText('작업 완료·정정 기록',{exact:true}).click();await page.getByRole('combobox',{name:'작업 선택',exact:true}).selectOption('m');
 await page.getByLabel('시작 (한국시간)').fill('2026-01-01T09:00');await page.getByLabel('종료 (한국시간)').fill('2026-01-01T10:00');await page.getByLabel('작업 확인 내용 / 정정 사유').fill('현장 확인');
 await page.getByRole('button',{name:'실적 확정 저장'}).click();await expect(page.getByText('테스트: 저장하지 않음',{exact:true})).toBeVisible();
 expect(requests[0].input).toMatchObject({expectedPlanVersion:7,startedAt:'2026-01-01T09:00:00+09:00'});
 await page.getByText('보고서 확정본 저장·조회',{exact:true}).click();await page.getByRole('combobox',{name:'확정본 구분',exact:true}).selectOption('SIMULATED');await page.getByRole('button',{name:'보고서 확정본 저장',exact:true}).click();await expect.poll(()=>requests.length).toBe(2);expect(requests[1]).toMatchObject({kind:'snapshot',input:{source:'SIMULATED',expectedHash:'a'.repeat(64)}});
});
