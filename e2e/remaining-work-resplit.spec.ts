import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {seedSplitWorkAreas} from '../tests/split-work-area-fixture';
import type {State} from '../lib/types';
import type {WorkMission} from '../lib/replan-work-split';

test.use({actionTimeout:15000});
test('resplits remaining work through approval and re-reviews only the unfinished field area',async({page},info)=>{
 test.setTimeout(150000);if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Disposable DB required');
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),calls=await db.aiCall.count(),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  const post=async(body:object)=>{const r=await page.request.post('/api/equipment-missions',{data:body});expect(r.status(),await r.text()).toBe(200);return r.json()};
  const {version,reviewedBy,...area}=f.area;await post({action:'area',version:0,area});
  const initial=(await (await page.request.get('/api/equipment-missions')).json()).groups[0];
  await post({action:'splitArea',version:0,fingerprint:initial.reviewFingerprint,area:f.input});
  // Input state represents a previously approved job with one completed part.
  f.parts[0].status='COMPLETED';const frozen=structuredClone(f.parts[0]),original=f.state.machines[0];
  f.state.machines.push({...original,id:'JB23TR02',capacityHaHour:.04});original.status='MAINTENANCE';
  await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(f.state))}});
  await page.setViewportSize({width:1440,height:1000});await page.goto('/?tab=schedule');
  await page.getByRole('combobox',{name:'일정 연도',exact:true}).selectOption('2032');await page.getByRole('button',{name:'9월',exact:true}).click();
  const day=page.getByTestId('schedule-day-2032-09-02');await day.locator('summary').click();await day.getByRole('button',{name:'관리',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.getByLabel('변경 사유',{exact:true}).fill('남은 회차를 저속 대체 장비로 나누어 진행');
  await modal.getByText('고장 장비 대체',{exact:true}).click();
  await modal.getByRole('combobox',{name:'고장 장비',exact:true}).selectOption('JB23TR01');
  await modal.getByRole('combobox',{name:'대체 장비',exact:true}).selectOption('JB23TR02');
  await modal.getByLabel('사용 시작일',{exact:true}).fill('2032-09-02');await modal.getByLabel('대여 종료일 (선택)',{exact:true}).fill('2032-09-03');
  await modal.getByRole('checkbox',{name:'도착·점검 일정 확정',exact:true}).check();await modal.getByRole('checkbox',{name:'작업기·진입·인력·운송 조건 확인',exact:true}).check();
  await modal.getByLabel('확인 근거',{exact:true}).fill('격리 입력: 대체 장비와 운송·인력 확인');
  await modal.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
  const option=modal.getByTestId('replan-option-preserve');await expect(option).toContainText('배치 가능');
  await option.getByRole('button',{name:'빈자리만 사용 · 선택',exact:true}).click();
  const review=modal.getByRole('region',{name:'선택안 상세 변경'});await expect(review).toContainText('분할 2/3');await expect(review).toContainText('분할 3/3');
  await page.screenshot({path:info.outputPath('remaining-parts-review-ko.png'),fullPage:true});
  await review.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();await expect(modal).toHaveCount(0);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  expect(saved.missions.find(m=>m.id===frozen.id)).toEqual(frozen);expect(saved.missions.filter(m=>m.status!=='COMPLETED')).toHaveLength(2);
  await page.goto('/?tab=equipment');const panel=page.getByTestId('equipment-missions');await panel.locator('summary').first().click();
  const group=page.getByTestId('split-area-'+f.groupId);await group.locator('summary').first().click();
  await expect(group).toContainText('남은 구역만 다시 나눕니다.');await group.getByRole('button',{name:'면적 비율로 구역 초안',exact:true}).click();
  const finishedArea=group.getByLabel('회차 1 GeoJSON',{exact:true});await expect(finishedArea).toHaveAttribute('readonly','');
  expect(JSON.parse(await finishedArea.inputValue())).toEqual(f.input.parts[0].geometry);
  await group.getByLabel('분할 확인 근거',{exact:true}).fill('격리 검증: 완료 구역 고정, 남은 구역 재확인');
  await group.getByRole('checkbox').check();await group.getByRole('button',{name:'분할 구역 일괄 확인·저장',exact:true}).click();await expect(group).toContainText('구역 연결 완료');
  await group.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('fixed-and-remaining-areas-ko.png'),fullPage:true});
  const data=await (await page.request.get('/api/equipment-missions')).json();expect(data.tasks).toHaveLength(2);expect(data.tasks.every((t:any)=>t.ready)).toBe(true);
  for(const task of data.tasks){
   const section=panel.locator(':scope > details').filter({has:page.locator(':scope > summary').filter({hasText:task.label})});
   await section.locator('summary').first().click();await section.getByRole('button',{name:'전달자료 생성',exact:true}).click();
   await expect(section.getByRole('button',{name:'내부 연결 수신 확인',exact:true})).toBeEnabled();
  }
  await page.getByLabel('언어 / Language').selectOption('en');await page.setViewportSize({width:390,height:844});await expect(group).toContainText('Completed area fixed');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('remaining-areas-mobile-en.png'),fullPage:true});
  expect(((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State).missions.find(m=>m.id===frozen.id)).toEqual(frozen);
  expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
  await info.attach('resplit-result',{body:JSON.stringify({realBusinessApis:true,completedRecordAndGeometryPreserved:true,remainingParts:2,geometryReapproved:true,paidAiCalls:0,actualSms:false,hardwareCommands:false}),contentType:'application/json'});
 }finally{await f.cleanup();await base.cleanup()}
});

test('links explicitly reviewed legacy work parts from the equipment screen without changing schedules',async({page},info)=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Disposable DB required');
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas();
 try{
  for(const [i,m] of (f.parts as WorkMission[]).entries()){delete m.equipmentSplit;delete m.equipmentWork;delete m.splitChildIds;m.operationKey='legacy:soil'+(i?':part2':'')}
  await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(f.state))}});
  const reservations=await db.workRecord.findMany({where:{kind:'resourceReservation'},orderBy:{id:'asc'}});
  await page.goto('/?tab=equipment');const panel=page.getByTestId('equipment-missions');await panel.locator('summary').first().click();
  const legacy=panel.locator('[data-testid^="legacy-parts-"]');await legacy.locator('summary').click();
  for(const n of [1,2]){await legacy.getByLabel(`기존 회차 ${n} m²`,{exact:true}).fill('5000');await legacy.getByLabel(`기존 회차 ${n} 준비시간`,{exact:true}).fill('60')}
  await legacy.getByLabel('이관 확인 근거',{exact:true}).fill('격리 검증: 승인된 회차별 작업량 확인');await legacy.getByRole('checkbox').check();
  await page.screenshot({path:info.outputPath('legacy-parts-review-ko.png'),fullPage:true});
  await legacy.getByRole('button',{name:'분할 식별정보 연결',exact:true}).click();await expect(legacy).toHaveCount(0);
  await expect(panel.locator('[data-testid^="split-area-"]')).toHaveCount(1);
  expect(await db.workRecord.count({where:{kind:'workPartLinkHistory'}})).toBe(2);
  expect(await db.workRecord.findMany({where:{kind:'resourceReservation'},orderBy:{id:'asc'}})).toEqual(reservations);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  for(const m of f.parts)expect(saved.missions.find(n=>n.id===m.id)).toMatchObject({id:m.id,status:m.status,scheduledDate:m.scheduledDate,resourceId:m.resourceId});
 }finally{await f.cleanup();await base.cleanup()}
});
