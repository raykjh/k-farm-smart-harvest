import {test,expect} from './authenticated-test';
import {PrismaClient} from '@prisma/client';
test('registration reaches managed field and cultivation planning through the UI',async({page,request},info)=>{
 test.setTimeout(180000);
 test.skip(process.env.KFARM_UI_E2E!=='1','Requires dedicated kfarm_ui_e2e server');
 const db=new PrismaClient({datasourceUrl:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_ui_e2e'});
 const initial=await db.center.findUniqueOrThrow({where:{id:'demo'}});await db.$disconnect();
 const live=await (await request.get('/api/workspace')).json();
 expect(live.state).toEqual(initial.state);expect(live.state.fields).toHaveLength(0);
 await page.goto('/register');
 await page.getByLabel('이름',{exact:true}).fill('홍검증');await page.getByLabel('생년월일').fill('1960-01-01');await page.getByLabel('연락처',{exact:true}).fill('000-0000-0000');
 await page.getByLabel('테스트 정보만 입력했으며 로컬 DB 저장을 확인합니다.').check();
 await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByRole('button',{name:'농지 추가',exact:true}).click();
 await page.getByLabel('지번 주소',{exact:true}).fill('전북특별자치도 장수군 계북면 농소리 1093');await page.getByLabel('작업 면적',{exact:false}).fill('1000');
 await page.getByRole('button',{name:'브이월드 지번 검색',exact:true}).click();await page.getByRole('button',{name:'필지 선택',exact:true}).first().click();await page.getByRole('button',{name:'필지 초안에 추가',exact:true}).click();
 await page.getByRole('button',{name:'다음',exact:true}).click();await expect(page.locator('.crop-choice')).toHaveCount(3);await page.locator('input[type=radio][value=rice]').check();
 await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByLabel('정보 이용·위임 범위를 상담에서 설명함 (데모 기록)').check();
 const saved=page.waitForResponse(r=>r.url().includes('/api/fields')&&r.request().method()==='POST');await page.getByRole('button',{name:'농지 목록에 저장 · 권한 보류',exact:true}).click();expect((await saved).status()).toBe(200);
 const fields=await (await request.get('/api/fields')).json();expect(fields.payload).toHaveLength(1);expect(fields.payload[0].crop).toBe('rice');expect(fields.payload[0].rights).toBe('pending');
 await info.attach('saved-fields',{body:JSON.stringify(fields,null,2),contentType:'application/json'});
 await page.goto('/');await page.getByRole('button',{name:'농지',exact:true}).click();await page.screenshot({path:'test-results/registered-field-audit.png',fullPage:true});
 await expect(page.getByTestId('ops-fields')).toContainText('농소리 1093');
 await page.getByText('재배 건 관리',{exact:false}).click();
 const date=(n:number)=>new Date(Date.now()+9*3600000+n*86400000).toISOString().slice(0,10);
 await page.getByRole('combobox',{name:'농지',exact:true}).selectOption(fields.payload[0].pnu);
 await page.getByLabel('재배 시작',{exact:true}).fill(date(0));await page.getByLabel('정리 완료 예정').fill(date(60));
 await page.getByText('지역·품종 작업 기준',{exact:true}).last().click();
 // Synthetic operator windows test the engine, not agronomic season suitability.
 for(const code of ['seed','nursery','soil','plant']){
  await page.getByLabel(code+' from',{exact:true}).last().fill(date(1));await page.getByLabel(code+' until',{exact:true}).last().fill(date(10));await page.getByLabel(code+' labor',{exact:true}).last().fill('1');
 }
 const created=page.waitForResponse(r=>r.url().includes('/api/cultivations')&&r.request().method()==='POST');await page.getByRole('button',{name:'재배 등록',exact:true}).click();expect((await created).status()).toBe(200);
 const calculated=page.waitForResponse(r=>r.url().includes('/api/annual-dispatch')&&r.request().method()==='GET');await page.getByRole('button',{name:'배차 검토',exact:true}).click();const preview=await (await calculated).json();expect(preview.assignments).toHaveLength(4);
 page.on('dialog',d=>d.accept());const assigned=page.waitForResponse(r=>r.url().includes('/api/annual-dispatch')&&r.request().method()==='POST');await page.getByRole('button',{name:'잠정 배차 저장',exact:true}).click();expect((await assigned).status()).toBe(200);
 await page.getByRole('button',{name:'일정표',exact:true}).click();await page.getByRole('button',{name:'전체',exact:true}).click();
 const day=page.getByTestId('schedule-day-'+preview.assignments[3].date);await day.locator('summary').click();await day.getByRole('button',{name:'관리',exact:true}).last().click();
 await page.getByLabel('변경 희망일 (비우면 자동 지정)',{exact:true}).fill(date(3));await page.getByLabel('변경 사유',{exact:true}).fill('등록 이후 일정 조정');
 await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();await expect(page.locator('.replan-option')).toHaveCount(3);
 const replanned=page.waitForResponse(r=>r.url().includes('/api/replanning')&&r.request().method()==='POST'&&r.request().postDataJSON().action==='preview');await page.getByRole('button',{name:'충돌 관련 일정 재배치 · 선택',exact:true}).click();const proposal=await (await replanned).json();expect(proposal.status,JSON.stringify(proposal)).toBe('FEASIBLE');expect(proposal.diff.length).toBeGreaterThan(0);
 const approved=page.waitForResponse(r=>r.url().includes('/api/replanning')&&r.request().method()==='POST');await page.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();expect((await approved).status()).toBe(200);
 await page.getByText('일정 변경·모의 알림 이력',{exact:true}).click();const delivered=page.waitForResponse(r=>r.url().includes('/api/operations')&&r.request().method()==='POST');await page.getByRole('button',{name:'대기 알림 모의 수신 처리',exact:true}).click();expect((await delivered).status()).toBe(200);
 await expect(page.getByText(/DELIVERED/).first()).toBeVisible();await page.getByRole('button',{name:'농부 화면',exact:true}).click();
 await expect(page.getByRole('heading',{level:1})).toContainText('홍검증');await expect(page.locator('.phone article')).toHaveCount(1);await expect(page.locator('.phone article')).toContainText(date(3));await expect(page.locator('.phone')).not.toContainText('아직 도착한 알림이 없습니다.');
 await page.reload();await page.getByRole('button',{name:'농부 화면',exact:true}).click();await expect(page.locator('.phone article')).toHaveCount(1);
 await page.screenshot({path:'test-results/registration-to-notification.png',fullPage:true});
 const final=await (await request.get('/api/workspace')).json();expect(final.state.fields).toHaveLength(1);expect(final.state.missions).toHaveLength(4);expect(final.notices.filter((n:any)=>n.status==='DELIVERED')).toHaveLength(1);expect(final.notices.filter((n:any)=>n.status==='SUPERSEDED')).toHaveLength(1);
 await info.attach('flow-result',{body:JSON.stringify({fields:1,missions:4,changes:proposal.diff.length,notices:final.notices.length,actualSms:false,paidAI:false}),contentType:'application/json'});
});
