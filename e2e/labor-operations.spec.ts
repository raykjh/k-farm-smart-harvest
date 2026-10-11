import {test,expect} from './authenticated-test';
import {PrismaClient} from '@prisma/client';
test('attendance auto-allocation, staff override and post-work penalty persist',async({page,request})=>{
 test.skip(process.env.KFARM_UI_E2E!=='1','Requires isolated UI database');test.setTimeout(120000);
 const db=new PrismaClient({datasourceUrl:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_ui_e2e'});
 try{
 const original=await db.center.findUniqueOrThrow({where:{id:'demo'}}),live=await(await request.get('/api/workspace')).json();expect(live.state).toEqual(original.state);expect(live.state.missions).toHaveLength(0);
 // Test-only past simple-work demand; no normal workspace mutation.
 const date=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10),s=original.state as any;
 s.missions=[{id:'labor-e2e',fieldId:'test-field',crop:'쌀',label:'단순 수거 검증',scheduledDate:date,month:Number(date.slice(5,7)),owner:'센터 인력',status:'PLANNED',resourceId:null,start:0,duration:4,deadline:32,priority:5,batchKey:'labor-e2e',staff:1,transport:0,operationCode:'finish'}];
 await db.center.update({where:{id:'demo'},data:{state:s}});await db.workRecord.create({data:{workspace:'sandbox',kind:'laborDemand',id:'labor-e2e',payload:{missionId:'labor-e2e'}}});
 await page.goto('/labor');await page.getByLabel('기록 담당자',{exact:true}).fill('검증 담당자');await page.getByText('희망자 등록·수정',{exact:true}).click();
 for(const name of ['홍인력','홍가까']){
  await page.getByLabel('이름',{exact:true}).fill(name);await page.getByLabel('생년월일',{exact:true}).fill('1960-01-01');await page.getByLabel('전화번호',{exact:true}).fill('000-0000-0000');await page.getByLabel('주소',{exact:true}).fill('계북면 가상 주소');await page.getByLabel('희망 날짜 (쉼표 구분 YYYY-MM-DD)',{exact:true}).fill(date);await page.getByLabel('가상 인적사항임을 확인합니다.',{exact:true}).check();
  const saved=page.waitForResponse(r=>r.url().includes('/api/labor-operations')&&r.request().method()==='POST');await page.getByRole('button',{name:'희망자 저장',exact:true}).click();expect((await saved).status()).toBe(200);await expect(page.getByLabel('이름',{exact:true})).toHaveValue('');
 }
 await page.getByLabel('보수·근무 조건',{exact:true}).fill('가상 보수 조건 / 지급 없음');await page.getByLabel('전문 장비 운전이 아닌 단순 작업임을 확인',{exact:true}).check();await page.getByRole('button',{name:'모집 안내 기록',exact:true}).click();await page.getByRole('button',{name:/단순 수거 검증 · OPEN/}).click();
 for(const [name,distance] of [['홍인력','5'],['홍가까','1']]){await page.getByLabel(name+' 거리',{exact:true}).fill(distance);const saved=page.waitForResponse(r=>r.url().includes('/api/labor-operations')&&r.request().method()==='POST');await page.getByLabel(name+' 거리',{exact:true}).blur();expect((await saved).status()).toBe(200);await expect(page.getByLabel(name+' 참석',{exact:true})).toBeEnabled();const response=page.waitForResponse(r=>r.url().includes('/api/labor-operations')&&r.request().method()==='POST');await page.getByLabel(name+' 참석',{exact:true}).selectOption('PHONE');expect((await response).status()).toBe(200);await expect(page.getByLabel(name+' 참석',{exact:true})).toBeEnabled();}
 await expect(page.getByText('배정: 홍가까 · 부족: 0 · 자동 적용',{exact:true})).toBeVisible();
 await page.getByLabel('홍인력 수정 선택',{exact:true}).check();await page.getByLabel('변경 사유',{exact:true}).fill('검증용 담당자 교체');await page.getByRole('button',{name:'선택 명단으로 수정',exact:true}).click();await expect(page.getByText('배정: 홍인력 · 부족: 0 · 담당자 수정 적용',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'자동 배정으로 복귀',exact:true}).click();await expect(page.getByText('배정: 홍가까 · 부족: 0 · 자동 적용',{exact:true})).toBeVisible();await page.getByText('근무 종료 후 실제 근무 기록',{exact:true}).click();await page.getByLabel('홍가까 실제 근무',{exact:true}).check();await page.getByRole('button',{name:'선택 근무자 완료 기록',exact:true}).click();await expect(page.getByText('근무 후 패널티',{exact:true})).toBeVisible();
 const data=await(await request.get('/api/labor-operations')).json(),worker=data.payload.people.find((p:any)=>p.name==='홍가까');await page.getByLabel('패널티 대상',{exact:true}).selectOption(worker.id);await page.getByLabel('패널티 사유',{exact:true}).fill('가상 근무 후 기록 검증');await page.getByRole('button',{name:'담당자 패널티 기록',exact:true}).click();await expect(page.getByText(/홍가까 · 95점/)).toBeVisible();await page.reload();await page.getByText('희망자 등록·수정',{exact:true}).click();await expect(page.getByText(/홍가까 · 95점/)).toBeVisible();
 const final=await(await request.get('/api/labor-operations')).json();expect(final.payload.jobs[0].status).toBe('COMPLETED');expect(final.payload.penalties).toHaveLength(1);expect(final.payload.notices.some((n:any)=>n.type==='CANCELLED')).toBe(true);await page.screenshot({path:'test-results/labor-operations.png',fullPage:true});
 const command={action:'sync',version:final.version,operator:'검증 담당자',requestId:crypto.randomUUID()};expect((await request.post('/api/labor-operations',{data:command})).status()).toBe(200);expect((await(await request.post('/api/labor-operations',{data:command})).json()).alreadyApplied).toBe(true);expect((await request.post('/api/labor-operations',{data:{...command,requestId:crypto.randomUUID()}})).status()).toBe(409);
 }finally{await db.$disconnect()}
});
