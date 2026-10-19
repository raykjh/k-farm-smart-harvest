import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {seedSplitWorkAreas} from '../tests/split-work-area-fixture';
import {openWorkOrder} from './work-order-navigation';
import {recordSpace} from '../lib/workspace';
import {emptyConditions} from '../lib/field-conditions';

test('field access and the equipment operator saved in their registers feed the task work order',async({page})=>{
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),key={workspace:recordSpace('demo'),kind:'fields',id:'current'};
 const previous=await db.workRecord.findUnique({where:{workspace_kind_id:key}}),calls=await db.aiCall.count();
 try{
  for(const m of f.state.missions)m.operatorIds=[];
  await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(f.state))}});
  const field=f.state.fields[0],payload=[{pnu:field.id,address:field.address,area:field.area,crop:'',group:'',mode:'full',rights:'pending',conditions:emptyConditions()}];
  await db.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,version:1,payload},update:{version:1,payload}});
  await page.goto('/?tab=equipment');await page.getByTestId('ops-equipment').getByRole('button',{name:'상세정보',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'수정',exact:true}).click();
  await page.getByRole('dialog').getByLabel('운용담당자',{exact:true}).selectOption(f.state.operatorRoster![0].id);
  await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/?tab=fields');const control=page.getByLabel(field.address+' 장비 진입',{exact:true});await expect(control).toHaveValue('unknown');
  await control.selectOption('yes');await control.locator('..').getByRole('button',{name:'저장',exact:true}).click();await expect(control.locator('..').getByRole('button',{name:'저장',exact:true})).toHaveCount(0);
  const panel=await openWorkOrder(page,f.parts[0]);await expect(panel.getByTestId('work-order-summary')).toContainText(f.state.operatorRoster![0].name);
  const packets=await (await page.request.get('/api/equipment-missions')).json(),task=packets.tasks.find((t:any)=>t.id===f.parts[0].id);
  expect(task.blockers).not.toContain('FIELD_ACCESS_REVIEW_REQUIRED');expect(task.blockers).not.toContain('NAMED_QUALIFIED_OPERATOR_REQUIRED');
  expect(task.blockers).toContain('OPERATOR_REVIEWED_WORK_AREA_REQUIRED');expect(task.data.executionAuthorized).toBe(false);
  await page.goto('/?tab=fields');await control.selectOption('no');await control.locator('..').getByRole('button',{name:'저장',exact:true}).click();await expect(control.locator('..').getByRole('button',{name:'저장',exact:true})).toHaveCount(0);
  const blocked=await (await page.request.get('/api/equipment-missions')).json();expect(blocked.tasks.find((t:any)=>t.id===f.parts[0].id).blockers).toContain('FIELD_ACCESS_REVIEW_REQUIRED');
  const stored=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as typeof f.state;
  expect(stored.missions).toEqual(f.state.missions);expect(await db.aiCall.count()).toBe(calls);
 }finally{
  await db.workRecord.deleteMany({where:key});if(previous)await db.workRecord.create({data:{...previous,payload:JSON.parse(JSON.stringify(previous.payload))}});await f.cleanup();await base.cleanup();
 }
});

test('task management keeps a fixed sheet and equal tabs across all five views',async({page},info)=>{
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),before=await db.center.findMany();
 const writes:string[]=[];page.on('request',r=>{if(r.url().includes('/api/')&&r.method()==='POST')writes.push(r.url())});
 try{
  await page.setViewportSize({width:1440,height:1000});await openWorkOrder(page,f.parts[0]);
  const dialog=page.getByRole('dialog'),tabs=dialog.locator('.task-management-tabs'),body=dialog.locator('.task-management-body');
  const original=await dialog.boundingBox();expect(original).not.toBeNull();let footerY:number|undefined;
  for(const [i,label] of ['일정변경','작업결과 입력','작업취소','작업 이력','작업지시서'].entries()){
   await tabs.getByRole('button',{name:label,exact:true}).click();await expect(body).toBeVisible();
   const rect=await dialog.boundingBox();expect(rect!.height).toBe(original!.height);expect(rect!.width).toBe(original!.width);
   const widths=await tabs.getByRole('button').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().width));expect(Math.max(...widths)-Math.min(...widths)).toBeLessThan(1);
   if(i<3){
    if(i===1)await body.getByLabel('작업 결과',{exact:true}).selectOption('HELD');
    const name=['일정변경 적용하기','미수행 저장 후 일정변경','작업 취소 확정'][i],button=await body.getByRole('button',{name,exact:true}).boundingBox();
    if(footerY===undefined)footerY=button!.y;else expect(Math.abs(button!.y-footerY)).toBeLessThan(2);
    expect(await body.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
   }
   if(label==='일정변경'){
    const inputs=body.locator('.replan-fields input,.replan-fields select'),a=await inputs.nth(0).boundingBox(),b=await inputs.nth(1).boundingBox();
    await expect(body.getByLabel('변경 희망일 (선택)',{exact:true})).toHaveValue('');await expect(body.getByLabel('변경 사유를 선택해주세요',{exact:true})).toHaveValue('');
    await body.getByLabel('변경 사유를 선택해주세요',{exact:true}).selectOption('기타 변경');
    await expect(body.getByRole('button',{name:'일정변경 적용하기',exact:true})).toBeVisible();
    await body.getByLabel('변경 사유를 선택해주세요',{exact:true}).selectOption('장비 문제');
    await expect(body.getByLabel('입고일',{exact:true})).toBeVisible();await expect(body.getByLabel('출고 예정일',{exact:true})).toBeVisible();
    await body.getByLabel('변경 사유를 선택해주세요',{exact:true}).selectOption('기타 변경');
    expect(a!.y).toBe(b!.y);expect(a!.height).toBe(b!.height);
   }
   if(label==='작업결과 입력'){
    await expect(body.locator('input[type=datetime-local]')).toHaveCount(0);
    await body.getByLabel('미수행 사유',{exact:true}).fill('배치 확인용 — 저장하지 않음');
   }
   await page.screenshot({path:info.outputPath(`task-sheet-${i}-ko.png`)});
  }
  await page.getByLabel('언어 / Language').selectOption('en');await page.setViewportSize({width:390,height:844});
  for(const label of ['Reschedule','Record result','Cancel task','Task history','Work order']){
   await tabs.getByRole('button',{name:label,exact:true}).click();await expect(body).toBeVisible();
   await expect.poll(async()=>{const d=await dialog.boundingBox();return !!d&&d.x>=0&&d.x+d.width<=391&&d.y+d.height<=845}).toBe(true);
   expect(await body.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  }
  await tabs.getByRole('button',{name:'Record result',exact:true}).click();
  await page.screenshot({path:info.outputPath('task-sheet-mobile-en.png')});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([]);expect(await db.center.findMany()).toEqual(before);
 }finally{await f.cleanup();await base.cleanup()}
});

test('schedule work order scopes one task, reviews its area, and stores local packets without changing plans',async({page},info)=>{
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),before=await db.center.findMany(),calls=await db.aiCall.count();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('/?tab=equipment');await expect(page.getByTestId('equipment-missions')).toHaveCount(0);
  let panel=await openWorkOrder(page,f.parts[0]);
  await expect(panel.locator('[data-testid^="work-order-packet-"]')).toHaveCount(1);
  await expect(panel.getByTestId('work-order-packet-'+f.parts[1].id)).toHaveCount(0);
  await expect(panel.getByTestId('work-order-summary')).toContainText(f.state.fields[0].address);
  await expect(panel.getByRole('button',{name:'전달자료 생성',exact:true})).toBeDisabled();
  await panel.getByText('현장 확인 작업구역 저장',{exact:true}).click();
  await expect(panel.getByLabel('등록 농지',{exact:true})).toHaveAttribute('readonly','');
  await panel.getByLabel('작업구역 GeoJSON (경도·위도)',{exact:true}).fill(JSON.stringify(f.area.geometry));
  await panel.getByLabel('현장 확인일',{exact:true}).fill(f.area.reviewedOn);
  await panel.getByLabel('확인 근거·제외구역 설명',{exact:true}).fill('격리 화면 검증용 작업구역');
  await panel.getByLabel('진입로·위험구역·제외구역을 별도로 확인했습니다.',{exact:true}).check();
  await panel.getByLabel('작업 장비가 농지에 안전하게 진입 가능한지 현장 확인했습니다.',{exact:true}).check();
  await panel.getByRole('button',{name:'작업구역 저장',exact:true}).click();
  const group=panel.getByTestId('split-area-'+f.groupId);await group.locator('summary').first().click();
  await expect(group.getByRole('button',{name:'면적 비율로 구역 초안',exact:true})).toBeEnabled();
  await group.getByRole('button',{name:'면적 비율로 구역 초안',exact:true}).click();
  await expect(group.getByLabel('회차 1 GeoJSON',{exact:true})).not.toHaveValue('');
  await group.getByLabel('분할 현장 확인일',{exact:true}).fill('2026-10-03');
  await group.getByLabel('분할 확인 근거',{exact:true}).fill('격리 합성 회차별 경계');await group.getByRole('checkbox').check();
  await group.getByRole('button',{name:'분할 구역 일괄 확인·저장',exact:true}).click();await expect(group).toContainText('구역 연결 완료');
  for(const task of f.parts){
   panel=await openWorkOrder(page,task);
   await expect(panel.locator('[data-testid^="work-order-packet-"]')).toHaveCount(1);
   await panel.getByRole('button',{name:'전달자료 생성',exact:true}).click();
   await expect(panel.getByRole('button',{name:'내부 연결 수신 확인',exact:true})).toBeEnabled();
   await panel.getByRole('button',{name:'내부 연결 수신 확인',exact:true}).click();
   await expect(panel.getByTestId('work-order-summary')).toContainText('내부 수신 확인');
  }
  const packets=await db.workRecord.findMany({where:{kind:'equipmentMission'}});expect(packets).toHaveLength(2);
  expect(packets.every(p=>!(p.payload as any).hardwareSent&&!(p.payload as any).executionAuthorized)).toBe(true);
  expect((packets[0].payload as any).data.workArea.geometry).not.toEqual((packets[1].payload as any).data.workArea.geometry);
  await page.screenshot({path:info.outputPath('work-order-ko.png')});
  await page.getByLabel('언어 / Language').selectOption('en');await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('dialog').getByRole('button',{name:'Work order',exact:true})).toBeVisible();
  await expect(panel.getByTestId('work-order-summary')).toContainText('Local receipt recorded');
  await expect(panel.locator('pre')).not.toBeVisible();
  await panel.getByText('Technical data / equipment integration',{exact:true}).click();
  await expect(panel.locator('pre')).toContainText('LOCAL_ADAPTER_ONLY');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('work-order-mobile-en.png')});
  expect(await db.center.findMany()).toEqual(before);expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
 }finally{await f.cleanup();await base.cleanup()}
});

test.describe('staff read-only work order',()=>{
 test.use({authRole:'CENTER_STAFF'});
 test('staff can inspect the selected work order without gaining packet-edit permissions',async({page})=>{
  const base=await laborCapacityFixture(),f=await seedSplitWorkAreas();
  try{
   const panel=await openWorkOrder(page,f.parts[0]);
   await expect(panel.getByRole('button',{name:'전달자료 생성',exact:true})).toHaveCount(0);
   await expect(panel.getByText('현장 확인 작업구역 저장',{exact:true})).toHaveCount(0);
   await expect(panel.getByTestId('work-order-packet-'+f.parts[1].id)).toHaveCount(0);
   expect(await db.workRecord.count({where:{kind:'equipmentMission'}})).toBe(0);
  }finally{await f.cleanup();await base.cleanup()}
 });
});
