import {test,expect} from './authenticated-test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {seedMission} from '../tests/labor-recovery-fixture';
import {testSession} from '../tests/auth-fixture';
import {dateSlot} from '../lib/scheduling-engine';
import {emptyLaborOps} from '../lib/labor-operations';
import {recordSpace} from '../lib/workspace';
import type {State} from '../lib/types';

const day='2032-09-01',next='2032-09-02',until='2032-09-08';
const evidence='.data/validation/20261003-loan-windows-ui';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
test.use({actionTimeout:15000});

test('two centers resolve equipment failure plus absence, preserving booked days, then reconfirm through real screens',async({page,browser})=>{
 test.setTimeout(180000);
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated PostgreSQL required');
 mkdirSync(evidence,{recursive:true});
 const extraKinds=['equipmentFailure','resourceImpact','centerResourceNotice'];
 const extra=await db.workRecord.findMany({where:{kind:{in:extraKinds}}});
 const f=await laborCapacityFixture(),ownerSession=await testSession('CENTER_ADMIN','janggye');
 const ownerContext=await browser.newContext({storageState:{cookies:[{name:'kfarm_session',value:ownerSession.token,domain:'127.0.0.1',path:'/',expires:Math.floor(Date.now()/1000)+3600,httpOnly:true,secure:false,sameSite:'Strict'}],origins:[]}});
 const owner=await ownerContext.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));owner.on('pageerror',e=>errors.push(e.message));
 const calls=await db.aiCall.count();
 try{
  const {m,closed}=await seedMission('demo'),helper={...f.worker,id:randomUUID(),name:'홍지원'};
  // Setup only: synthetic participants, equipment, and reviewed work windows.
  // Every incident, authorization, support confirmation and approval below uses UI.
  for(const center of ['demo','janggye']){
   const row=await db.center.findUniqueOrThrow({where:{id:center}}),s=row.state as unknown as State;
   const id=center==='demo'?'JB23PD01':'JSJGPD01',operator=randomUUID();
   s.crewCapacity={operators:1,workers:1};s.staffCount=2;s.transportCount=1;
   s.machines=[{id,ownerCenterId:center,name:'감자 굴취기',type:'감자 굴취기',capacityHaHour:0.2,status:'AVAILABLE',safetyLock:false,compatibleCrops:['potato']}];
   s.operatorRoster=[{id:operator,name:'홍운영',active:true,kinds:['PD'],weekdays:[0,1,2,3,4,5,6],from:day,until,excludedDates:[],startMinute:480,endMinute:960,evidence:'격리된 자격·근무 가정'}];
   const task={...m,label:'감자 굴취 및 수거 보조',crop:'감자' as const,owner:'장비' as const,resourceId:id,staff:2,ordinaryWorkers:1,machineOperators:1,operatorIds:[operator],duration:28,transport:1,compatibilityCrop:'potato' as const,planningWindow:{from:day,to:next,duration:28,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'}};
   const lenderTask={...task,id:'lender-fixed',fieldId:'lender-field',ordinaryWorkers:0,staff:1,scheduledDate:next,start:dateSlot(next)-dateSlot('2026-09-09'),planningLocked:true};
   s.missions=center==='demo'?[closed,task]:[lenderTask];
   if(center==='demo')s.fields[0].crop='감자';
   await db.center.update({where:{id:center},data:{state:json(s)}});
  }
  await db.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace('janggye'),kind:'laborOperations',id:'current'}},data:{payload:json({...emptyLaborOps(),people:[helper]})}});
  const lenderBefore=await db.center.findUniqueOrThrow({where:{id:'janggye'}});
  let labor=await (await page.request.get('/api/labor-operations')).json();
  for(const body of [{action:'open',demandId:m.id,pay:'격리 검증 근무',simpleWorkConfirmed:true}]){
   const r=await page.request.post('/api/labor-operations',{data:{...body,version:labor.version,requestId:randomUUID()}});expect(r.status(),await r.text()).toBe(200);
  }
  labor=await (await page.request.get('/api/labor-operations')).json();const job=labor.payload.jobs[0];
  const attending=await page.request.post('/api/labor-operations',{data:{action:'response',jobId:job.id,workerId:f.worker.id,response:'PHONE',version:labor.version,requestId:randomUUID()}});expect(attending.status(),await attending.text()).toBe(200);

  await page.goto('/?tab=labor');await page.getByText('전체 모집·과거 배정',{exact:true}).click();await page.getByRole('button',{name:/2032-09-01 · 감자 굴취/}).click();
  const attendance=page.getByRole('dialog');await attendance.getByLabel('변경 사유',{exact:true}).fill('당일 무통보 불참 확인');await attendance.getByRole('button',{name:'홍가상 불참 기록',exact:true}).click();await expect(attendance).toContainText('부족: 1');await attendance.getByRole('button',{name:'닫기',exact:true}).click();

  await page.goto('/reservations');await page.getByText('장비 고장·수리 예정 기록',{exact:true}).click();await page.getByRole('combobox',{name:'고장 장비',exact:true}).selectOption('JB23PD01');await page.getByLabel('고장 발생일',{exact:true}).fill(day);await page.getByLabel('수리 예정일',{exact:true}).fill(until);
  const failure=page.waitForResponse(r=>r.url().endsWith('/api/center-resources')&&r.request().method()==='POST');await page.getByRole('button',{name:'고장 기록·영향 조회',exact:true}).click();expect((await failure).status()).toBe(200);

  await owner.goto('http://127.0.0.1:3100/reservations');await owner.getByText('사전 허용 장비·공유 조건 관리',{exact:true}).click();
  await owner.getByRole('combobox',{name:'소유 장비',exact:true}).selectOption('JSJGPD01');await owner.getByRole('combobox',{name:'사용 센터',exact:true}).selectOption('demo');await owner.getByLabel('허용 시작일',{exact:true}).fill(day);await owner.getByLabel('허용 종료일',{exact:true}).fill(until);
  await owner.getByLabel('협약·내부 승인 근거',{exact:true}).fill('격리 화면 검증용 사전 합의');await owner.getByLabel('작업기·진입·운영자·운송 조건',{exact:true}).fill('호환·진입·운송·복귀 확인');await owner.getByRole('checkbox',{name:'JB23PD01',exact:true}).check();await owner.getByRole('checkbox',{name:/호환성·운영자·운송을 확인/}).check();
  const authorization=owner.waitForResponse(r=>r.url().endsWith('/api/center-resources')&&r.request().method()==='POST');await owner.getByRole('button',{name:'사전 허용 저장',exact:true}).click();expect((await authorization).status()).toBe(200);

  async function compare(){
   await page.goto('/?tab=labor');const recovery=page.getByTestId('labor-recovery');await recovery.locator('summary').first().click();await recovery.getByRole('button',{name:/대체 인력·일정 비교/}).click();
   const modal=page.getByRole('dialog');await modal.getByLabel('변경 사유',{exact:true}).fill('장비 고장과 인력 결원 동시 대응');await modal.getByRole('button',{name:'변경 대안 비교',exact:true}).click();await expect(modal.getByRole('region',{name:'변경 대안 비교 결과'})).toBeVisible();return modal;
  }
  let modal=await compare();await expect(modal.getByTestId('replan-option-preserve')).toContainText('배치 불가');await expect(modal.getByTestId('replan-option-expand')).toContainText('배치 불가');await page.screenshot({path:evidence+'/blocked-without-labor.png',fullPage:true});

  await owner.goto('http://127.0.0.1:3100/?tab=labor');const support=owner.getByTestId('labor-capacity');await support.locator('summary').first().click();
  await support.getByRole('combobox',{name:'지원 희망자',exact:true}).selectOption(helper.id);await support.getByRole('combobox',{name:'지원받는 인접센터',exact:true}).selectOption('demo');await support.getByLabel('지원일',{exact:true}).fill(day);await support.getByLabel('편도 이동시간').fill('30');await support.getByLabel('제안·확정·취소 사유',{exact:true}).fill('고장과 결원에 대한 인접 지원');await support.getByRole('checkbox').check();await support.getByRole('button',{name:'지원시간 제안',exact:true}).click();await expect(support.locator('tbody')).toContainText('수용 센터 확인 대기');
  modal=await compare();await expect(modal.getByTestId('replan-option-preserve')).toContainText('배치 불가');
  await page.goto('/?tab=labor');const incoming=page.getByTestId('labor-capacity');await incoming.locator('summary').first().click();await incoming.getByLabel('제안·확정·취소 사유',{exact:true}).fill('지원 가능 시간과 이동 확인');await incoming.getByRole('button',{name:'지원시간 확정',exact:true}).click();await expect(incoming.locator('tbody')).toContainText('지원시간 확정');

  modal=await compare();await expect(modal.getByTestId('replan-option-preserve')).toContainText('배치 가능');await modal.getByRole('button',{name:'빈자리만 사용 · 선택',exact:true}).click();const review=modal.getByRole('region',{name:'선택안 상세 변경'});await expect(review).toContainText('JB23PD01 → JSJGPD01');await expect(review).toContainText('인접센터 지원 배정 변경 · 참석 재확인');await expect(review).toContainText(day);
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);await page.screenshot({path:evidence+'/compound-plan-review.png',fullPage:true});
  await review.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  expect(saved.missions.find(t=>t.id===m.id)).toMatchObject({scheduledDate:day,resourceId:'JSJGPD01'});expect(saved.missions.find(t=>t.id===closed.id)).toEqual(closed);expect(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(lenderBefore);
  const loans=await db.workRecord.findMany({where:{kind:'equipmentLoan'}});expect(loans).toHaveLength(1);expect(loans[0].payload).toMatchObject({usableFrom:day,usableUntil:day});
  const renewed=(await (await page.request.get('/api/labor-operations')).json()).payload.jobs.find((j:any)=>j.replacesJobId===job.id);expect(renewed.responses).toEqual({});expect(renewed.borrowedNames).toEqual([]);

  await owner.reload();const reconfirm=owner.getByTestId('labor-sharing');await reconfirm.locator('summary').first().click();await reconfirm.getByRole('combobox',{name:'지원할 인접센터 작업',exact:true}).selectOption('demo:'+renewed.id);await reconfirm.getByRole('combobox',{name:'우리 센터 희망자',exact:true}).selectOption(helper.id);await reconfirm.getByLabel('편도 이동시간 (분)',{exact:true}).fill('30');await reconfirm.getByLabel('확인 거리 (km)',{exact:true}).fill('5');await reconfirm.getByRole('checkbox').check();await reconfirm.getByRole('button',{name:'지원 참석 등록·배정',exact:true}).click();await expect(reconfirm.locator('tbody')).toContainText('홍지원');await expect(reconfirm.locator('tbody')).toContainText('배정');
  await page.reload();const received=page.getByTestId('labor-sharing');await received.locator('summary').first().click();await expect(received.locator('tbody')).toContainText('홍지원');await expect(received.locator('tbody')).toContainText('배정');await received.getByText('양쪽 센터 안내 기록',{exact:true}).click();await expect(received).toContainText('홍지원');
  const capacity=page.getByTestId('labor-capacity');await capacity.locator('summary').first().click();await capacity.getByText('지원시간·계획 변경 안내',{exact:true}).click();await expect(capacity).toContainText('작업 변경 · 참석 재확인');await page.screenshot({path:evidence+'/reconfirmed-receiver.png',fullPage:true});
  await owner.reload();const ownerCapacity=owner.getByTestId('labor-capacity');await ownerCapacity.locator('summary').first().click();await ownerCapacity.getByText('지원시간·계획 변경 안내',{exact:true}).click();await expect(ownerCapacity).toContainText('작업 변경 · 참석 재확인');
  await owner.setViewportSize({width:390,height:844});await owner.getByLabel('언어 / Language').selectOption('en');await expect(ownerCapacity).toContainText('Work changed / reconfirm attendance');expect(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await owner.screenshot({path:evidence+'/owner-mobile-en.png',fullPage:true});
  expect(await db.outbox.count({where:{id:{startsWith:'replan:'}}})).toBeGreaterThan(0);expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
  writeFileSync(evidence+'/browser-result.json',JSON.stringify({checkedAt:new Date().toISOString(),database:'kfarm_test',realBusinessApis:true,businessResponseInterception:false,compoundFailureAndAbsence:true,offeredSupportNotCounted:true,confirmedSupportAndEquipmentApproved:true,lenderAndCompletedWorkPreserved:true,attendanceReconfirmed:true,bothCenterNotices:true,koreanDesktopAndEnglishMobile:true,paidAiCalls:0,externalSms:false,hardwareCommands:false},null,2));
 }finally{
  await ownerContext.close();await ownerSession.cleanup();await f.cleanup();await db.workRecord.deleteMany({where:{kind:{in:extraKinds}}});if(extra.length)await db.workRecord.createMany({data:extra as any});
 }
});
