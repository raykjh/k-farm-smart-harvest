import {test,expect} from './authenticated-test';
import {PrismaClient} from '@prisma/client';
test('delegated registration without crop selection → batch proposal → approval → notification',async({page,request})=>{
 test.setTimeout(180000);test.skip(process.env.KFARM_UI_E2E!=='1','Requires isolated UI DB');
 const db=new PrismaClient({datasourceUrl:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_ui_e2e'});
 try{
 const initial=await db.center.findUniqueOrThrow({where:{id:'demo'}}),live=await (await request.get('/api/workspace')).json();expect(live.state).toEqual(initial.state);expect(live.state.fields).toHaveLength(0);
 const date=(n:number)=>new Date(Date.now()+9*3600000+n*86400000).toISOString().slice(0,10);
 await page.goto('/register');await page.getByLabel('이름',{exact:true}).fill('홍위탁');await page.getByLabel('생년월일').fill('1960-01-01');await page.getByLabel('연락처',{exact:true}).fill('000-0000-0000');await page.getByLabel('테스트 정보만 입력했으며 로컬 DB 저장을 확인합니다.').check();
 await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByRole('button',{name:'농지 추가',exact:true}).click();await page.getByLabel('지번 주소',{exact:true}).fill('전북특별자치도 장수군 계북면 농소리 1093');await page.getByLabel('작업 면적',{exact:false}).fill('1000');await page.getByRole('button',{name:'브이월드 지번 검색',exact:true}).click();await page.getByRole('button',{name:'필지 선택',exact:true}).first().click();await page.getByRole('button',{name:'필지 초안에 추가',exact:true}).click();await page.getByRole('button',{name:'다음',exact:true}).click();
 await page.locator('input[value=delegated]').check();await page.getByText('농지·지역 조건 확인 및 추천 근거',{exact:true}).click();
 await page.getByRole('combobox',{name:'현 이용형태',exact:true}).selectOption('paddy');await page.getByRole('combobox',{name:'용수 확보',exact:true}).selectOption('yes');await page.getByRole('combobox',{name:'작업 장비 진입',exact:true}).selectOption('yes');await page.getByRole('combobox',{name:'필수 인력 확보',exact:true}).selectOption('yes');await page.getByLabel('검토 지역',{exact:true}).fill('계북면');await page.getByRole('combobox',{name:'쌀 · 지역·품종 적합성 검토',exact:true}).selectOption('suitable');await page.getByLabel('확인일',{exact:true}).fill(date(0));await page.getByLabel('출처·품종·현장 확인자 및 근거',{exact:true}).fill('UI 검증 가정: 실제 농지 조사 결과 아님');
 // Intentionally do NOT select a crop.
 await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByLabel('정보 이용·위임 범위를 상담에서 설명함 (데모 기록)').check();const saved=page.waitForResponse(r=>r.url().includes('/api/fields')&&r.request().method()==='POST');await page.getByRole('button',{name:'농지 목록에 저장 · 권한 보류',exact:true}).click();expect((await saved).status()).toBe(200);
 await page.goto('/');await page.getByRole('button',{name:'농지',exact:true}).click();const panel=page.getByTestId('delegated-planning');await panel.getByText('센터 공통 작업 기준',{exact:true}).click();await panel.getByLabel('배치 대상 시작일').fill(date(0));await panel.getByLabel('배치 대상 종료일').fill(date(60));await panel.getByText('지역·품종 작업 기준',{exact:true}).click();
 for(const code of ['seed','nursery','soil','plant']){await panel.getByLabel(code+' from',{exact:true}).fill(date(1));await panel.getByLabel(code+' until',{exact:true}).fill(date(10));await panel.getByLabel(code+' labor',{exact:true}).fill('30');}
 const settingsSaved=page.waitForResponse(r=>r.url().includes('/api/delegated-planning')&&r.request().method()==='POST');await panel.getByRole('button',{name:'공통 기준 저장',exact:true}).click();expect((await settingsSaved).status()).toBe(200);
 const calculated=page.waitForResponse(r=>r.url().includes('/api/delegated-planning')&&r.request().method()==='POST');await panel.getByRole('button',{name:'위탁 농지 배치안 계산',exact:true}).click();let proposal=await (await calculated).json();expect(proposal.plans[0].cultivation.crop).toBe('rice');expect(proposal.assigned).toBe(4);expect(proposal.unassigned).toBe(6);expect(proposal.demand[0].staffPeak).toBeGreaterThan(0);
 expect(proposal.approvalBlocked).toBe(true);
 await panel.getByLabel(/미배정·권한 확인 대기를 확인/).check();
 await expect(panel.getByRole('button',{name:'작물·계획·배차 일괄 확정',exact:true})).toBeDisabled();
 expect((await request.post('/api/delegated-planning',{data:{action:'approve',proposalId:proposal.proposalId,provisionalAcknowledged:true}})).status()).toBe(409);
 // Complete synthetic essential windows; these are test assumptions, not agronomic dates.
 // A concurrent operator changes criteria; the old approval must fail atomically.
 const current=(await (await request.get('/api/delegated-planning')).json()).settings;current.context.operations.rice.seed.laborMinutesPer1000m2=31;
 for(const code of ['harvest','finish'])current.context.operations.rice[code]={from:date(11),to:date(20),laborMinutesPer1000m2:30};
 expect((await request.post('/api/delegated-planning',{data:{action:'settings',settings:current}})).status()).toBe(200);
 expect((await request.post('/api/delegated-planning',{data:{action:'approve',proposalId:proposal.proposalId,provisionalAcknowledged:true}})).status()).toBe(409);
 const recalculated=page.waitForResponse(r=>r.url().includes('/api/delegated-planning')&&r.request().method()==='POST');await panel.getByRole('button',{name:'위탁 농지 배치안 계산',exact:true}).click();proposal=await (await recalculated).json();
 expect((await (await request.get('/api/workspace')).json()).state.missions).toHaveLength(0);
 await panel.getByLabel(/미배정·권한 확인 대기를 확인/).check();await panel.screenshot({path:'test-results/delegated-proposal.png'});const approved=page.waitForResponse(r=>r.url().includes('/api/delegated-planning')&&r.request().method()==='POST');await panel.getByRole('button',{name:'작물·계획·배차 일괄 확정',exact:true}).click();expect((await approved).status()).toBe(200);
 const retry=await request.post('/api/delegated-planning',{data:{action:'approve',proposalId:proposal.proposalId,provisionalAcknowledged:true}});expect((await retry.json()).alreadyApplied).toBe(true);
 expect(await db.workRecord.count({where:{kind:'laborDemand'}})).toBe(6);const fields=await (await request.get('/api/fields')).json();expect(fields.payload[0].crop).toBe('rice');expect(fields.payload[0].rights).toBe('pending');
 await page.getByRole('button',{name:'일정표',exact:true}).click();await page.getByText('일정 변경·모의 알림 이력',{exact:true}).click();const delivery=page.waitForResponse(r=>r.url().includes('/api/operations')&&r.request().method()==='POST');await page.getByRole('button',{name:'대기 알림 모의 수신 처리',exact:true}).click();expect((await delivery).status()).toBe(200);await page.getByRole('button',{name:'농부 화면',exact:true}).click();await expect(page.locator('.phone article')).toHaveCount(1);await expect(page.locator('.phone article')).toContainText('위탁 농지');await page.screenshot({path:'test-results/delegated-notification.png',fullPage:true});
 // Recalculation excludes the already-approved period, preserving all six jobs.
 const again=await request.post('/api/delegated-planning',{data:{action:'preview'}});expect((await again.json()).assigned).toBe(0);expect((await (await request.get('/api/workspace')).json()).state.missions).toHaveLength(6);
 }finally{await db.$disconnect()}
});
