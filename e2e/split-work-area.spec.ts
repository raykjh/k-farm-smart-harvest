import {test,expect} from './authenticated-test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {seedSplitWorkAreas} from '../tests/split-work-area-fixture';
import {openWorkOrder} from './work-order-navigation';
const evidence='.data/validation/20261003-split-work-areas';
test('reviews split areas, prepares distinct local packets, and invalidates stale geometry through real APIs',async({page})=>{
 test.setTimeout(100000);if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated PostgreSQL required');
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),calls=await db.aiCall.count(),centerBefore=await db.center.findMany(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));mkdirSync(evidence,{recursive:true});
 try{
  const {version,reviewedBy,...area}=f.area;
  const saved=await page.request.post('/api/equipment-missions',{data:{action:'area',version:0,area}});expect(saved.status(),await saved.text()).toBe(200);
  await page.setViewportSize({width:1440,height:1000});
  const panel=await openWorkOrder(page,f.parts[0]);
  const group=page.getByTestId('split-area-'+f.groupId);await group.locator('summary').first().click();
  await group.getByRole('button',{name:'면적 비율로 구역 초안',exact:true}).click();
  await expect(group.getByLabel('회차 1 GeoJSON',{exact:true})).not.toHaveValue('');
  expect(await db.workRecord.count({where:{kind:'splitWorkArea'}})).toBe(0);
  await expect(group.getByRole('button',{name:'분할 구역 일괄 확인·저장',exact:true})).toBeDisabled();
  await group.getByLabel('분할 현장 확인일',{exact:true}).fill('2026-10-03');await group.getByLabel('분할 확인 근거',{exact:true}).fill('격리 화면 검증: 실제 현장 확인 주장이 아님');
  await group.getByRole('checkbox').check();await group.getByRole('button',{name:'분할 구역 일괄 확인·저장',exact:true}).click();
  await expect(group).toContainText('구역 연결 완료');await expect(group.getByRole('img',{name:'분할 작업구역 미리보기'})).toBeVisible();
  await group.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/split-areas-ko.png',fullPage:true});
  const tasks=await (await page.request.get('/api/equipment-missions')).json();expect(tasks.tasks).toHaveLength(2);
  for(const task of tasks.tasks){
   await openWorkOrder(page,task);const section=panel.getByTestId('work-order-packet-'+task.id);
   await expect(section.getByRole('button',{name:'전달자료 생성',exact:true})).toBeEnabled();await section.getByRole('button',{name:'전달자료 생성',exact:true}).click();
   await expect(section.getByRole('button',{name:'내부 연결 수신 확인',exact:true})).toBeEnabled();await section.getByRole('button',{name:'내부 연결 수신 확인',exact:true}).click();await expect(panel.getByTestId('work-order-summary')).toContainText('내부 수신 확인');
  }
  const packets=await db.workRecord.findMany({where:{kind:'equipmentMission'}});expect(packets).toHaveLength(2);expect(JSON.stringify((packets[0].payload as any).data.workArea.geometry)).not.toBe(JSON.stringify((packets[1].payload as any).data.workArea.geometry));
  expect(packets.every(r=>!(r.payload as any).hardwareSent&&!(r.payload as any).executionAuthorized)).toBe(true);
  // Edit through the existing field form: both reviewed links and packets must become stale.
  await panel.getByText('현장 확인 작업구역 저장',{exact:true}).click();await expect(panel.getByLabel('등록 농지',{exact:true})).toHaveAttribute('readonly','');
  await panel.getByLabel('확인 근거·제외구역 설명',{exact:true}).fill('격리 검증 전체 구역 재검토');await panel.getByRole('checkbox',{name:'진입로·위험구역·제외구역을 별도로 확인했습니다.',exact:true}).check();await panel.getByRole('checkbox',{name:'작업 장비가 농지에 안전하게 진입 가능한지 현장 확인했습니다.',exact:true}).check();await panel.getByRole('button',{name:'작업구역 저장',exact:true}).click();
  await group.locator('summary').first().click();await expect(group).toContainText('다시 확인');await expect(panel.getByRole('button',{name:'전달자료 생성',exact:true}).first()).toBeDisabled();
  await page.getByLabel('언어 / Language').selectOption('en');await page.setViewportSize({width:390,height:844});await expect(group).toContainText('Field areas by work part');await group.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:evidence+'/split-areas-mobile-en.png',fullPage:true});
  expect(await db.center.findMany()).toEqual(centerBefore);expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
  writeFileSync(evidence+'/browser-result.json',JSON.stringify({checkedAt:new Date().toISOString(),database:'kfarm_test',actualBusinessApis:true,interceptedBusinessResponses:false,parts:2,unreviewedDraftNotSaved:true,distinctWorkPolygons:true,localReceipts:2,parentRevisionInvalidates:true,koreanDesktopEnglishMobile:true,centerRecordsPreserved:true,paidAiCalls:0,hardwareSent:false,actualSms:false},null,2));
 }finally{await f.cleanup();await base.cleanup();}
});
