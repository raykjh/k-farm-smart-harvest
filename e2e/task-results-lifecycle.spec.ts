import {test,expect} from './authenticated-test';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {emptyCenter} from '../lib/center-registry';
import {dateSlot} from '../lib/scheduling-engine';
import type {Mission,State} from '../lib/types';

const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const day=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const offset=(d:string,n:number)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
async function fixture(){
 const base=await laborCapacityFixture(),kinds=['fields','fieldParticipation','fieldClosure','taskCancellation','taskExecutionAssessment','workDurationCorrection'];
 const previous=await db.workRecord.findMany({where:{kind:{in:kinds}}});await db.workRecord.deleteMany({where:{kind:{in:kinds}}});
 const s=emptyCenter('demo');s.staffCount=4;s.crewCapacity={operators:2,workers:2};s.transportCount=2;
 s.fields=[{id:'5274036023900010001',farmerId:'synthetic-owner',name:'홍검증',address:'계북면 격리 검증 필지',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'',source:'DEMO_ASSUMPTION'}];
 s.machines=[{id:'JB23TR01',type:'트랙터',name:'트랙터1호',status:'AVAILABLE',safetyLock:false,capacityHaHour:1,compatibleCrops:['rice'],...{ledger:{model:'Test-100'}}}];
 s.missions=[0,0,1].map((n,i)=>({id:'ui-result-'+i,fieldId:s.fields[0].id,crop:'쌀',label:'농지 정리 '+i,owner:i===2?'농부':'장비',resourceId:i===2?null:'JB23TR01',status:'PLANNED',scheduledDate:offset(day(),n),month:Number(day().slice(5,7)),start:dateSlot(offset(day(),n))-dateSlot('2026-09-09'),duration:4,deadline:32,priority:1,batchKey:'test',staff:1,transport:i===2?0:1,machineOperators:i===2?0:1,ordinaryWorkers:0,farmerWorkers:i===2?1:0,compatibilityCrop:'rice',planningWindow:{from:offset(day(),-2),to:offset(day(),10),duration:4,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'},...{predecessorMissionIds:[],operationKey:'isolated:task:'+i}} as Mission));
 await db.center.update({where:{id:'demo'},data:{state:json(s)}});
 await db.workRecord.create({data:{workspace:'sandbox',kind:'fields',id:'current',payload:[{pnu:s.fields[0].id,address:s.fields[0].address,crop:'rice',group:'',area:1000,mode:'full',rights:'pending'}]}});
 return {s,cleanup:async()=>{await db.workRecord.deleteMany({where:{kind:{in:kinds}}});if(previous.length)await db.workRecord.createMany({data:previous as any});await base.cleanup()}};
}
async function manage(page:import('@playwright/test').Page,m:Mission){
 await page.goto('/?tab=schedule');await page.getByRole('combobox',{name:'일정 연도',exact:true}).selectOption(m.scheduledDate!.slice(0,4));
 await page.locator('.month-tabs').getByRole('button',{name:Number(m.scheduledDate!.slice(5,7))+'월',exact:true}).click();
 const section=page.getByTestId('schedule-day-'+m.scheduledDate);if(await section.getAttribute('open')===null)await section.locator('summary').click();
 await section.getByTestId('schedule-task-'+m.id).getByRole('button',{name:'관리',exact:true}).click();return page.getByRole('dialog');
}

test('received result becomes field-owned time history, corrections retain raw evidence, and missed work leads directly to rescheduling',async({page},info)=>{
 const f=await fixture(),calls=await db.aiCall.count();
 try{
  let modal=await manage(page,f.s.missions[0]);await modal.getByRole('button',{name:'작업결과 입력',exact:true}).click();
  await expect(modal.locator('input[type=datetime-local]')).toHaveCount(0);await expect(modal).toContainText('작업결과 수신 대기');
  const reportId=randomUUID(),date=f.s.missions[0].scheduledDate!,r=await page.request.post('/api/execution-records',{data:{kind:'received',input:{id:reportId,missionId:f.s.missions[0].id,expectedPlanVersion:f.s.planVersion,resourceId:'JB23TR01',startedAt:date+'T09:00:00+09:00',finishedAt:date+'T10:00:00+09:00'}}});
  expect(r.status(),await r.text()).toBe(200);await modal.getByRole('button',{name:'수신 결과 새로고침',exact:true}).click();await expect(modal).toContainText('작업결과 수신 완료');await expect(modal).toContainText('60');
  await page.goto('/?tab=fields');await page.getByTestId('ops-fields').getByRole('button',{name:'관리',exact:true}).click();await page.getByRole('tab',{name:'작업 이력',exact:true}).click();
  modal=page.getByRole('dialog');await expect(modal).toContainText('평균 작업시간 60분');await modal.getByRole('button',{name:'정정',exact:true}).click();
  await modal.getByLabel('작업시간 (분)',{exact:true}).fill('45');await modal.getByLabel('정정 사유',{exact:true}).fill('격리 수신 시간 정정');await modal.getByRole('button',{name:'정정 저장',exact:true}).click();
  await expect(modal).toContainText('평균 작업시간 45분');expect(await db.workRecord.count({where:{kind:'taskExecutionAssessment'}})).toBe(2);
  const original=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'taskExecutionAssessment',id:reportId}}})).payload as any;expect(original.simulatedFinishedAt).toBe(date+'T10:00:00+09:00');
  await page.screenshot({path:info.outputPath('field-result-history.png')});
  modal=await manage(page,f.s.missions[1]);await modal.getByRole('button',{name:'작업결과 입력',exact:true}).click();await modal.getByLabel('작업 결과',{exact:true}).selectOption('HELD');
  await modal.getByLabel('미수행 사유',{exact:true}).fill('당일 작업 지연');await modal.getByRole('button',{name:'미수행 저장 후 일정변경',exact:true}).click();
  await expect(modal.getByLabel('변경 사유를 선택해주세요',{exact:true})).toBeVisible();
  expect(((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State).missions[1].status).toBe('HELD');
  await modal.getByLabel('변경 사유를 선택해주세요',{exact:true}).selectOption('장비 문제');await expect(modal).toContainText('Test-100 (트랙터1호)');
  await expect(modal.getByLabel('입고일',{exact:true})).toBeVisible();await expect(modal.getByLabel('출고 예정일',{exact:true})).toBeVisible();
  expect(await db.aiCall.count()).toBe(calls);
 }finally{await f.cleanup()}
});

test('crop and service termination remove remaining work from the schedule while retaining history',async({page})=>{
 const f=await fixture();
 try{
  let modal=await manage(page,f.s.missions[1]);await modal.getByRole('button',{name:'작업취소',exact:true}).click();
  await modal.getByLabel('취소 구분',{exact:true}).selectOption('CROP_CHANGE');await modal.getByLabel('취소 사유',{exact:true}).fill('작물 변경 결정');await modal.getByRole('checkbox').check();
  await modal.getByRole('button',{name:'작업 취소 확정',exact:true}).click();await expect(modal).toHaveCount(0);
  await page.goto('/?tab=fields');await expect(page.getByTestId('ops-fields')).toContainText('작물 선택 대기');
  await page.getByTestId('ops-fields').getByRole('button',{name:'관리',exact:true}).click();await page.getByRole('tab',{name:'작업 이력',exact:true}).click();modal=page.getByRole('dialog');await expect(modal.locator('tbody tr')).toHaveCount(3);await expect(modal).toContainText('취소');
  await page.keyboard.press('Escape');await page.getByTestId('ops-fields').getByRole('button',{name:'관리',exact:true}).click();await page.getByRole('tab',{name:'작물·생산',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'작물 선택·일정 등록',exact:true})).toBeVisible();
  // The second scenario starts from the same disposable input, not a mutation of operating data.
  await db.center.update({where:{id:'demo'},data:{state:json(f.s)}});
  modal=await manage(page,f.s.missions[1]);await modal.getByRole('button',{name:'작업취소',exact:true}).click();await modal.getByLabel('취소 구분',{exact:true}).selectOption('WITHDRAWAL');
  await modal.getByLabel('취소 사유',{exact:true}).fill('소유주 위탁 종료');await modal.getByRole('checkbox').check();await modal.getByRole('button',{name:'작업 취소 확정',exact:true}).click();await expect(modal).toHaveCount(0);
  await page.goto('/?tab=fields');await expect(page.getByTestId('ops-fields').getByRole('button',{name:'관리',exact:true})).toHaveCount(0);
  expect(await db.workRecord.count({where:{kind:'fieldClosure'}})).toBe(2);
 }finally{await f.cleanup()}
});
