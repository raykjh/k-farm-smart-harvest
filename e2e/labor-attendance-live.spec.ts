import {randomUUID} from 'node:crypto';
import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {emptyLaborOps,ordinaryLaborAvailability,type LaborOps} from '../lib/labor-operations';
import {refreshCenterAttendance} from '../lib/labor-attendance-store';
import type {State,Mission} from '../lib/types';

const offset=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));

test('the ordinary screen opens D-7 staffing, records a standby reply and shows D-2 replacement for operator acknowledgement',async({page},info)=>{
 const fixture=await laborCapacityFixture(),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),date=offset(today,7),calls=await db.aiCall.count();
 const key={workspace:'sandbox',kind:'laborOperations',id:'current'},errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  const state=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  state.ruleVersion='ATTENDANCE_ISOLATED_'+randomUUID();
  state.fields=[{id:'attendance-field',farmerId:'synthetic-owner',name:'홍가상',address:'격리 참석 확인용 농지',area:1000,crop:'고추',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'DEMO_ASSUMPTION'}];
  const mission:Mission&{operationCode:string}={id:'attendance-task',fieldId:state.fields[0].id,crop:'고추',label:'참석 확인용 단순 수확',owner:'센터 인력',resourceId:null,status:'PLANNED',start:0,duration:4,deadline:32,priority:1,batchKey:'attendance',staff:1,ordinaryWorkers:1,transport:0,scheduledDate:date,month:Number(date.slice(5,7)),operationCode:'harvest',planningWindow:{from:date,to:offset(date,2),duration:4,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'}};
  const closed={...mission,id:'attendance-protected-history',scheduledDate:offset(today,-1),status:'COMPLETED' as const};
  state.missions=[closed,mission];
  const people=['홍가람','홍나래','홍다온'].map((name,i)=>({...fixture.worker,...ordinaryLaborAvailability(),name,id:`00000000-0000-4000-8000-00000000000${i+1}`}));
  await db.center.update({where:{id:'demo'},data:{state:json(state)}});
  await db.workRecord.create({data:{workspace:'sandbox',kind:'laborDemand',id:mission.id,payload:{missionId:mission.id}}});
  await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:json({...emptyLaborOps(),people})}});
  // Authenticate against the disposable DB and verify its marker before UI writes.
  const live=await page.request.get('/api/workspace');expect(live.status()).toBe(200);expect((await live.json()).state.ruleVersion).toBe(state.ruleVersion);
  const saved=async()=>(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}})).payload as unknown as LaborOps;
  const openJob=async()=>{
   await page.getByRole('button',{name:date+' 1명',exact:true}).click();
   await page.getByRole('dialog').getByRole('button',{name:'1명 · 명단 선택',exact:true}).click();
   return page.getByRole('dialog',{name:'작업별 인력 배정',exact:true});
  };
  await page.goto('/?tab=labor');
  await page.getByRole('button',{name:date+' 1명',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'1명 · 모집 안내',exact:true}).click();
  let modal=page.getByRole('dialog',{name:'인력 모집 안내',exact:true});
  await modal.getByLabel('보수·근무 조건',{exact:true}).fill('격리 검증 조건 · 실제 지급 없음');
  await modal.getByLabel('전문 장비 운전이 아닌 단순 작업임을 확인',{exact:true}).check();
  await modal.getByRole('button',{name:'자동 배정 등록',exact:true}).click();await expect(modal).toHaveCount(0);
  let ops=await saved();expect(ops.jobs[0].attendance?.proposed).toEqual([people[0].id]);expect(ops.jobs[0].assigned).toEqual([]);
  modal=await openJob();await expect(modal.getByRole('region',{name:'참석 확정 일정'})).toContainText('확답 대기 1명');
  await modal.getByLabel(people[1].name+' 참석',{exact:true}).selectOption('PHONE');
  await expect(modal.getByLabel(people[1].name+' 참석',{exact:true})).toBeEnabled();
  await expect.poll(async()=>(await saved()).jobs[0].responses[people[1].id]).toBe('PHONE');
  expect((await saved()).jobs[0].assigned).toEqual([]);
  // Advance only the scheduled worker's injected clock. Do not falsify app time,
  // API replies, completed work, or attendance responses.
  const cutoff=offset(date,-2)+'T00:00:00+09:00';
  expect(await refreshCenterAttendance('demo',cutoff)).toBe(true);
  expect(await refreshCenterAttendance('demo',cutoff)).toBe(false);
  await page.reload();modal=await openJob();
  await expect(modal.getByRole('region',{name:'참석 확정 일정'})).toContainText('마감 미확정으로 교체: '+people[0].name);
  await expect(modal.getByRole('region',{name:'참석 확정 일정'})).toContainText('필요 인원의 참석이 확인되었습니다.');
  await expect(modal.getByLabel(people[0].name+' 참석',{exact:true})).toBeDisabled();
  await modal.getByRole('button',{name:'배정 결과 확인',exact:true}).click();
  await expect(modal.getByRole('button',{name:'담당자 확인 완료',exact:true})).toBeDisabled();
  ops=await saved();expect(ops.jobs[0].assigned).toEqual([people[1].id]);expect(ops.jobs[0].attendance?.expired).toEqual([people[0].id]);expect(ops.jobs[0].attendance?.reviewedAt).toBeTruthy();expect(ops.penalties).toEqual([]);
  expect(ops.notices.some(n=>n.workerId===people[0].id&&n.type==='EXPIRED')).toBe(true);
  expect(ops.notices.some(n=>n.workerId===people[1].id&&n.type==='ASSIGNED')).toBe(true);
  expect(ops.notices.every(n=>n.status==='MOCK_RECORDED')).toBe(true);
  expect(((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State).missions).toEqual([closed,mission]);
  expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/ui-attendance-cutoff-reviewed.png'});
  await info.attach('attendance-timeline',{body:JSON.stringify({ordinaryUI:true,workerClockAdvancedOnly:true,unconfirmedWorkerExpired:1,verifiedReplacement:1,operatorReviewed:true,automaticPenalty:0,paidModelCalls:0,actualMessages:0}),contentType:'application/json'});
 }finally{await fixture.cleanup()}
});
