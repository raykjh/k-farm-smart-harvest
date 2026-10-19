import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import type {State,Mission} from '../lib/types';
import type {Page} from '@playwright/test';
import {emptyCenter} from '../lib/center-registry';
import {saveLoan} from '../lib/center-resources';
import {testPrincipal} from '../tests/auth-fixture';
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const offset=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function openDay(page:Page,date:string){
 await page.goto('/?tab=schedule');
 await page.getByLabel('일정 연도',{exact:true}).selectOption(date.slice(0,4));
 await page.getByRole('button',{name:Number(date.slice(5,7))+'월',exact:true}).click();
 const day=page.getByTestId('schedule-day-'+date);
 if(await day.getAttribute('open')===null)await day.locator('summary').click();
 await day.getByRole('button',{name:'일정변경',exact:true}).click();
 return page.getByRole('dialog');
}
test('today, selected date and a repair interval all use the real engine, approve into the isolated DB and retain history',async({page})=>{
 test.setTimeout(120000);const fixture=await laborCapacityFixture(),errors:string[]=[],d=today();page.on('pageerror',e=>errors.push(e.message));
 try{
  const s=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  s.machines=[{id:'JB23DR01',ownerCenterId:'demo',name:'드론',type:'DR',status:'AVAILABLE',safetyLock:false,capacityHaHour:1}];s.staffCount=2;s.crewCapacity={operators:1,workers:1};s.transportCount=1;
  s.fields=[{id:'schedule-fixture',farmerId:'synthetic-farmer',name:'홍검증',address:'격리 검증용 필지',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'DEMO_ASSUMPTION'}];
  const m:Mission={id:'today-task',fieldId:s.fields[0].id,crop:'쌀',label:'검증 드론 작업',owner:'장비',resourceId:'JB23DR01',status:'PLANNED',start:0,duration:4,deadline:32,priority:1,batchKey:'test',staff:1,transport:1,scheduledDate:d,month:Number(d.slice(5,7)),planningWindow:{from:d,to:offset(d,12),duration:4,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'},...{predecessorMissionIds:[]}};
  const closed={...m,id:'history-closed',scheduledDate:offset(d,-1),status:'COMPLETED' as const};s.missions=[m,{...m,id:'future-task',scheduledDate:offset(d,3)},closed];
  await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(s))}});const aiBefore=await db.aiCall.count();
  const read=async()=>(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  async function calculateAndApprove(reason:string){
   const modal=page.getByRole('dialog');await modal.getByLabel('변경 사유',{exact:true}).selectOption(reason);
   for(const text of ['일정변경 진행','AI 판단 함께 비교','판단 근거','계산 대안 상세'])await expect(modal.getByText(text,{exact:true})).toHaveCount(0);
   await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();
   await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();
   await page.screenshot({path:'test-results/ui-automatic-replan-saved.png'});
   await modal.getByRole('button',{name:'완료',exact:true}).click();await expect(modal).toHaveCount(0);
  }
  await page.goto('/');await page.getByRole('button',{name:'일정변경',exact:true}).click();await calculateAndApprove('기타 변경');
  expect((await read()).missions.find(m=>m.id==='today-task')!.scheduledDate).toBe(offset(d,1));
  await openDay(page,offset(d,3));await calculateAndApprove('기상 부적합');
  expect((await read()).missions.find(m=>m.id==='future-task')!.scheduledDate).toBe(offset(d,1));
  const modal=await openDay(page,offset(d,1));await modal.getByLabel('변경 사유',{exact:true}).selectOption('장비 문제');await expect(modal.getByLabel('문제 장비',{exact:true})).toHaveCount(0);await expect(modal).toContainText('JB23DR01');await modal.getByLabel('입고일',{exact:true}).fill(offset(d,1));await modal.getByLabel('출고 예정일',{exact:true}).fill(offset(d,7));
  await page.screenshot({path:'test-results/ui-repair-period.png'});await calculateAndApprove('장비 문제');
  const saved=await read();expect(saved.machines[0].downtimes).toEqual([{machineId:'JB23DR01',from:offset(d,1),returnOn:offset(d,7)}]);
  expect(saved.missions.filter(m=>m.status!=='COMPLETED').every(m=>m.scheduledDate!>=offset(d,7))).toBe(true);expect(saved.missions.find(m=>m.id===closed.id)).toEqual(closed);
  expect(await db.aiCall.count()).toBe(aiBefore);expect(errors).toEqual([]);
  await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();await page.screenshot({path:'test-results/ui-rescheduled-live-db.png',fullPage:true});
 }finally{await fixture.cleanup()}
});
for(const occupied of [false,true])test(`one form saves the preferred date or its nearest free day: occupied=${occupied}`,async({page})=>{
 test.setTimeout(90000);const fixture=await laborCapacityFixture(),d=today(),preferred=offset(d,5),calls=await db.aiCall.count();
 try{
  const s=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  s.staffCount=2;s.crewCapacity={operators:1,workers:1};s.transportCount=1;
  s.fields=[{id:'single-form-field',farmerId:'synthetic-owner',name:'홍검증',address:'격리 검증 필지',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'DEMO_ASSUMPTION'}];
  s.machines=[{id:'JB23DR01',ownerCenterId:'demo',type:'DR',name:'드론',status:'AVAILABLE',safetyLock:false,capacityHaHour:1}];
  const task:Mission&{predecessorMissionIds:string[]}={id:'single-form-task',fieldId:s.fields[0].id,crop:'쌀',label:'희망일 검증 작업',owner:'장비',resourceId:'JB23DR01',status:'PLANNED',start:0,duration:4,deadline:32,priority:1,batchKey:'test',staff:1,transport:1,scheduledDate:offset(d,3),month:Number(d.slice(5,7)),planningWindow:{from:d,to:offset(d,12),duration:4,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'},predecessorMissionIds:[]};
  const blocker={...task,id:'locked-work',scheduledDate:preferred,duration:32,planningWindow:{...task.planningWindow!,duration:32},planningLocked:true};
  s.missions=occupied?[task,blocker]:[task];await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(s))}});
  let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/replanning'))posts++});
  const modal=await openDay(page,offset(d,3));
  for(const text of ['오늘 미완료 작업','특정 날짜 작업','변경할 작업일','장비 고장·수리로 변경','대상 작업 보기'])await expect(modal.getByText(text,{exact:true})).toHaveCount(0);
  await expect(modal.getByLabel('변경 사유',{exact:true}).locator('option')).toHaveText(['기상 부적합','장비 문제','기타 변경']);
  await modal.getByLabel('변경 사유',{exact:true}).selectOption('장비 문제');await expect(modal.getByLabel('입고일',{exact:true})).toBeVisible();
  await modal.getByLabel('변경 사유',{exact:true}).selectOption('기타 변경');await expect(modal.getByLabel('입고일',{exact:true})).toHaveCount(0);await expect(modal.getByLabel('출고 예정일',{exact:true})).toHaveCount(0);
  await modal.getByLabel('변경 희망일 (선택)',{exact:true}).fill(preferred);
  await expect(modal.getByLabel('변경 희망일 (선택)',{exact:true})).toHaveValue(preferred);
  await expect(modal.getByRole('button',{name:'일정변경 진행',exact:true})).toHaveCount(0);expect(posts).toBe(0);
  await page.screenshot({path:`test-results/ui-one-form-preferred-${occupied}.png`});
  await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State,date=saved.missions.find(m=>m.id===task.id)!.scheduledDate!;
  if(occupied){expect(Math.abs(Date.parse(date)-Date.parse(preferred))).toBe(86400000);expect(saved.missions.find(m=>m.id===blocker.id)).toEqual(blocker)}else expect(date).toBe(preferred);
  expect(posts).toBe(1);expect(await db.aiCall.count()).toBe(calls);
 }finally{await fixture.cleanup()}
});

test('repair beyond the crop window requests an adjacent machine, then applies the approved loan from the same popup',async({page})=>{
 const fixture=await laborCapacityFixture(),d=today(),date=offset(d,1),calls=await db.aiCall.count();
 try{
  const s=emptyCenter('demo');s.staffCount=2;s.crewCapacity={operators:1,workers:1};s.transportCount=1;
  s.fields=[{id:'loan-field',farmerId:'synthetic-owner',name:'홍가상',address:'격리 검증 농지',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'DEMO_ASSUMPTION'}];
  s.machines=[{id:'JB23DR01',ownerCenterId:'demo',type:'DR',name:'드론',status:'AVAILABLE',capacityHaHour:1,safetyLock:false,compatibleCrops:['rice']}];
  const task:Mission={id:'loan-task',fieldId:s.fields[0].id,crop:'쌀',label:'방제 작업',owner:'장비',resourceId:'JB23DR01',status:'PLANNED',start:0,duration:4,deadline:32,priority:1,batchKey:'isolated',staff:1,transport:1,scheduledDate:date,month:Number(date.slice(5,7)),planningWindow:{from:date,to:offset(d,2),duration:4,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'},...{predecessorMissionIds:[]}};
  s.missions=[task];const lender=emptyCenter('janggye');lender.machines=[{...s.machines[0],id:'JSJGDR01',ownerCenterId:'janggye'}];lender.staffCount=1;lender.crewCapacity={operators:1,workers:0};lender.transportCount=1;
  for(const [id,state] of [['demo',s],['janggye',lender]] as const)await db.center.update({where:{id},data:{state:JSON.parse(JSON.stringify(state))}});
  const modal=await openDay(page,date);await modal.getByLabel('변경 사유',{exact:true}).selectOption('장비 문제');await modal.getByLabel('출고 예정일',{exact:true}).fill(offset(d,7));
  await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();await expect(modal).toContainText('인접 센터 장비 요청 · 승인 대기');await expect(modal).toContainText('JSJGDR01');
  expect(((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State).missions).toEqual(s.missions);
  const loan=await db.workRecord.findFirstOrThrow({where:{kind:'equipmentLoan'}});expect(loan.payload).toMatchObject({status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false});
  expect(await db.workRecord.count({where:{kind:'centerResourceNotice'}})).toBe(2);
  await page.screenshot({path:'test-results/ui-repair-loan-request.png'});
  await db.$transaction(tx=>saveLoan(tx,{...(loan.payload as object),version:loan.version,status:'CONFIRMED',operatorConfirmed:true,transportConfirmed:true},{...testPrincipal,centerId:'janggye'}));
  await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;expect(saved.missions[0]).toMatchObject({resourceId:'JSJGDR01',scheduledDate:date});expect(await db.aiCall.count()).toBe(calls);
  await page.screenshot({path:'test-results/ui-repair-loan-applied.png'});
 }finally{await fixture.cleanup()}
});

test('ordinary labor form saves without personal calendar or skill restrictions',async({page})=>{
 const fixture=await laborCapacityFixture();try{
  await page.goto('/?tab=labor');await page.getByRole('button',{name:'＋ 인력 등록',exact:true}).click();const form=page.getByRole('dialog');
  for(const name of ['가능 시작시간','가능 종료시각','희망 날짜','제외 날짜','희망요일','가능 작업코드','근무 신청 활성'])await expect(form.getByText(name,{exact:false})).toHaveCount(0);
  await expect(form.getByLabel('배정 대상에 포함')).toBeChecked();await form.getByLabel('이름',{exact:true}).fill('홍가명');await form.getByLabel('생년월일',{exact:true}).fill('1960-01-01');await form.getByLabel('전화번호',{exact:true}).fill('000-0000-0000');await form.getByLabel('주소',{exact:true}).fill('격리 검증용 가상 주소');await form.getByLabel('실제 개인정보가 포함되지 않았음을 확인합니다.').check();
  await page.screenshot({path:'test-results/ui-labor-simple-form.png'});await form.getByRole('button',{name:'희망자 저장',exact:true}).click();await expect(form).toHaveCount(0);
  const result=await (await page.request.get('/api/labor-operations')).json(),person=result.payload.people.find((p:any)=>p.name==='홍가명');expect(person).toMatchObject({active:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:0,endMinute:1440,workCodes:['*']});
 }finally{await fixture.cleanup()}
});
