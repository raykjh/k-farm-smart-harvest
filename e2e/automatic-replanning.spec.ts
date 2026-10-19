import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import type {State,Mission} from '../lib/types';
test.use({authRole:'CENTER_STAFF'});
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const offset=(day:string,n:number)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
for(const screen of ['desktop','mobile'] as const)test(`${screen}: equipment request has no manual conversion and a registered spare completes rescheduling`,async({page},info)=>{
 test.setTimeout(90000);const f=await laborCapacityFixture(),d=today(),calls=await db.aiCall.count();
 try{
  if(screen==='mobile')await page.setViewportSize({width:390,height:844});
  const read=async()=>(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  const s=await read();s.staffCount=3;s.crewCapacity={operators:1,workers:2};s.transportCount=1;
  s.fields=[{id:'manual-field',farmerId:'synthetic-owner',name:'홍가상',address:'격리 검증 농지',area:1000,crop:'감자',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'DEMO_ASSUMPTION'}];
  s.machines=[{id:'JB23PD01',ownerCenterId:'demo',type:'감자 굴취기',name:'굴취기',status:'MAINTENANCE',capacityHaHour:0.5,safetyLock:false,compatibleCrops:['potato']}];
  const task:Mission={id:'manual-task',fieldId:s.fields[0].id,crop:'감자',label:'감자 수확',owner:'장비',resourceId:'JB23PD01',compatibilityCrop:'potato',status:'HELD',start:0,duration:4,deadline:32,priority:1,batchKey:'isolated',staff:1,ordinaryWorkers:0,machineOperators:1,transport:1,scheduledDate:d,month:Number(d.slice(5,7)),planningWindow:{from:d,to:offset(d,7),duration:4,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'},...{predecessorMissionIds:[]}};
  s.missions=[task];await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(s))}});
  const open=async()=>{await page.getByRole('button',{name:'일정변경',exact:true}).click();return page.getByRole('dialog')};
  await page.goto('/');let modal=await open();await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();
  await expect(modal.getByTestId('automatic-replan-needs')).toBeVisible();await expect(modal).toContainText('추가 장비 확보 필요');
  expect((await read()).missions).toEqual([task]);await page.screenshot({path:`test-results/ui-resource-request-${screen}.png`});
  await modal.getByRole('button',{name:'닫기',exact:true}).click();modal=await open();await expect(modal.getByTestId('automatic-replan-needs')).toBeVisible();
  await expect(modal.getByRole('button',{name:'인력 대체 기준 입력',exact:true})).toHaveCount(0);
  await expect(modal).not.toContainText('인력 대체');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  // Only the fixture resource input changes. The ordinary screen/API must
  // recompute, book and save; the test does not inject a prepared schedule.
  const updated=await read();updated.machines.push({...updated.machines[0],id:'JB23PD02',status:'AVAILABLE'});
  await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(updated)),version:{increment:1}}});
  await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();
  const table=modal.locator('.schedule-change-results');await expect(table).toBeVisible();await expect(table.getByRole('columnheader')).toHaveText(['일자','농지','작물','작업','장비 / 인력','변경 내용']);await expect(table).toContainText('격리 검증 농지');await expect(table.locator('del').first()).toContainText(d);await expect(table).toContainText('JB23PD01');await expect(table).toContainText('JB23PD02');await expect(table.getByRole('cell').last()).not.toContainText('시간');
  const final=await read();expect(final.missions[0]).toMatchObject({resourceId:'JB23PD02',duration:4,machineOperators:1,ordinaryWorkers:0});expect(final.missions[0].scheduledDate!>d).toBe(true);expect(final.missions[0].executionMethod).toBeUndefined();
  await page.screenshot({path:`test-results/ui-equipment-only-saved-${screen}.png`});await modal.getByRole('button',{name:'완료',exact:true}).click();await expect(modal).toHaveCount(0);expect(await db.aiCall.count()).toBe(calls);
  await info.attach('equipment-only-flow',{body:JSON.stringify({screen,manualConversionRemoved:true,scheduleUnchangedUntilReschedule:true,paidAiCalls:0,actualSms:false,hardwareCommands:false}),contentType:'application/json'});
 }finally{await f.cleanup()}
});
