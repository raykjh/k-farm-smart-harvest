import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {randomUUID} from 'node:crypto';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {emptyLaborOps,newAttendance} from '../lib/labor-operations';
import {defaultLaborPolicy,payBasis} from '../lib/labor-policy';
const day=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10),year=Number(day.slice(0,4)),pnu='5274036023900010098',cycleId=randomUUID(),missionId='ui-ledger:'+cycleId;
const kinds=['operatingLedger','cultivation','cultivationPlan','laborPolicy','laborPolicyHistory'];
let base:Awaited<ReturnType<typeof laborCapacityFixture>>,previous:any[];
test.beforeAll(async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Only isolated kfarm_test');
 base=await laborCapacityFixture();previous=await db.workRecord.findMany({where:{workspace:'sandbox',kind:{in:kinds}}});await db.workRecord.deleteMany({where:{workspace:'sandbox',kind:{in:kinds}}});
 const state=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
 state.fields=[{id:pnu,farmerId:randomUUID(),name:'홍검증',address:'계북면 격리 검증 농지 98',area:1000,crop:'고추',mode:'완전 위탁형',source:'DEMO_ASSUMPTION',access:true,water:true,confirmed:true,cluster:''}];
 state.machines=[{id:'JB23CB01',name:'검증 콤바인 1호',type:'벼 콤바인',status:'AVAILABLE',safetyLock:false,capacityHaHour:1,compatibleCrops:['rice'],ledger:{kind:'CB',model:'검증모델'}}];
 state.missions=[{id:missionId,cultivationId:cycleId,fieldId:pnu,label:'최종 수확·선별',crop:'고추',scheduledDate:day,month:Number(day.slice(5,7)),status:'COMPLETED',resourceId:'JB23CB01',owner:'장비',start:0,duration:16,staff:1,transport:0,deadline:16,priority:1,batchKey:'test'}];
 await db.center.update({where:{id:'demo'},data:{state}});
 await db.workRecord.createMany({data:[{workspace:'sandbox',kind:'cultivation',id:cycleId,payload:{id:cycleId,pnu,crop:'pepper',start:`${year}-01-01`,end:`${year}-12-31`,source:'REGISTERED'}},{workspace:'sandbox',kind:'cultivationPlan',id:cycleId,payload:{year,plots:[{cultivationId:cycleId,pnu,address:state.fields[0].address,area:1000,crop:'pepper',referenceId:'pepper-statistical',yieldRange:{low:227,high:278},yieldBasis:'HISTORICAL_MIN_MAX_NOT_FORECAST',tasks:[]}]}}]});
 const ops={...emptyLaborOps(),people:[base.worker],jobs:[{id:randomUUID(),missionId,task:'최종 수확·선별',address:state.fields[0].address,date:day,startMinute:480,durationMinutes:240,count:1,workCode:'harvest',sourceHash:'test',pay:'공통 보수',payBasis:payBasis(defaultLaborPolicy(2026)),status:'COMPLETED',invited:[base.worker.id],responses:{[base.worker.id]:'PHONE'},distances:{},assigned:[base.worker.id],manual:null,worked:[base.worker.id],attendance:newAttendance()}]};
 await db.workRecord.update({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}},data:{payload:JSON.parse(JSON.stringify(ops))}});
});
test.afterAll(async()=>{if(base){await db.workRecord.deleteMany({where:{workspace:'sandbox',kind:{in:kinds}}});if(previous.length)await db.workRecord.createMany({data:previous});await base.cleanup();}});
test('keeps equipment operating logs inside the register and removes operator/transport controls',async({page})=>{
 await page.goto('/?tab=equipment');await expect(page.getByRole('tab',{name:'장비대장',exact:true})).toBeVisible();await expect(page.getByRole('tab',{name:'운용담당자·운송'})).toHaveCount(0);
 await page.getByRole('button',{name:'상세정보',exact:true}).first().click();await expect(page.getByTestId('equipment-work-log')).toBeVisible();await expect(page.getByTestId('equipment-work-log')).toContainText('최종 수확·선별');
 await page.getByRole('button',{name:'수정',exact:true}).click();await expect(page.getByLabel('운용담당자',{exact:true})).toHaveCount(0);await expect(page.getByLabel('장비코드',{exact:true})).toHaveValue('JB23CB01');
});
test('uses one employee count and common pay; records a half-shift exception without rewriting the original',async({page})=>{
 await page.goto('/?tab=labor');await expect(page.getByRole('tab',{name:'배치 기준'})).toHaveCount(0);
 const common=page.getByTestId('labor-common-policy');await expect(common.getByLabel('센터 직접고용 인력')).toHaveValue('3');await common.getByLabel('센터 직접고용 인력').fill('4');await common.getByRole('button',{name:'저장',exact:true}).click();await expect(common).toContainText('저장했습니다');
 await page.getByRole('button',{name:'근무 기록',exact:true}).click();const history=page.getByTestId('worker-work-history');await expect(history).toContainText('41,280원');await history.getByRole('button',{name:'근무 예외 기록'}).click();await history.getByLabel('실제 근무량 (반나절=1)',{exact:true}).fill('0.5');await history.getByLabel('특수 상황 사유').fill('개인 사정으로 2시간 근무');await history.getByRole('button',{name:'기록 저장'}).click();await expect(history).toContainText('20,640원');
 const record=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}});expect((record.payload as any).jobs[0].payBasis.halfDayWon).toBe(41280);expect((record.payload as any).penalties).toHaveLength(0);expect((record.payload as any).workExceptions).toHaveLength(1);
});
test('shows annual forecasts and saves shipment, expense, owner payment and correction through the UI',async({page})=>{
 await page.goto('/?tab=reports');await expect(page.getByRole('tab',{name:'예측',exact:true})).toBeVisible();await expect(page.getByTestId('annual-operating-reports')).toContainText('227–278 kg');
 await page.getByRole('tab',{name:'실적',exact:true}).click();await page.getByRole('button',{name:'＋ 출하·매출',exact:true}).click();await page.getByLabel('기록일',{exact:true}).fill(day);await page.getByLabel('생산물 형태',{exact:true}).fill('건고추');await page.getByLabel('출하량 (kg)',{exact:true}).fill('50');await page.getByLabel('기록 금액 (원)',{exact:true}).fill('400000');await page.getByLabel('내역 · 근거',{exact:true}).fill('검증용 출하 기록');await page.getByRole('button',{name:'기록 저장',exact:true}).click();await expect(page.getByRole('button',{name:'기록 저장',exact:true})).toHaveCount(0);await expect(page.getByRole('row').filter({hasText:'검증용 출하 기록'})).toBeVisible();
 await page.getByRole('button',{name:'＋ 작업 비용',exact:true}).click();await page.getByLabel('기록일',{exact:true}).fill(day);await page.getByLabel('작업',{exact:true}).selectOption(missionId);await page.getByLabel('기록 금액 (원)',{exact:true}).fill('50000');await page.getByLabel('내역 · 근거',{exact:true}).fill('검증용 수확 작업비');await page.getByRole('button',{name:'기록 저장',exact:true}).click();await expect(page.getByRole('button',{name:'기록 저장',exact:true})).toHaveCount(0);await expect(page.getByRole('row').filter({hasText:'검증용 수확 작업비'})).toBeVisible();
 await page.getByRole('button',{name:'＋ 소유주 지급',exact:true}).click();await page.getByLabel('기록일',{exact:true}).fill(day);await page.getByLabel('기록 금액 (원)',{exact:true}).fill('300000');await page.getByLabel('내역 · 근거',{exact:true}).fill('검증용 소유주 지급 기록');await page.getByRole('button',{name:'기록 저장',exact:true}).click();await expect(page.getByRole('button',{name:'기록 저장',exact:true})).toHaveCount(0);await expect(page.getByRole('row').filter({hasText:'검증용 소유주 지급 기록'})).toBeVisible();
 const shipment=page.getByRole('row').filter({hasText:'검증용 출하 기록'});await shipment.getByRole('button',{name:'정정'}).click();await page.getByLabel('출하량 (kg)',{exact:true}).fill('45');await page.getByLabel('내역 · 근거',{exact:true}).fill('출하 중량 확인 후 정정');await page.getByRole('button',{name:'기록 저장',exact:true}).click();await expect(page.getByRole('button',{name:'기록 저장',exact:true})).toHaveCount(0);await expect(page.getByRole('row').filter({hasText:'출하 중량 확인 후 정정'})).toBeVisible();
 await page.screenshot({path:'.data/operating-records-actuals.png',fullPage:true});
 const rows=await db.workRecord.findMany({where:{workspace:'sandbox',kind:'operatingLedger'}});expect(rows).toHaveLength(4);expect(rows.some(r=>(r.payload as any).supersedesId)).toBe(true);
});
test('reads the same shipment and cost records from the managed field without duplicating data',async({page})=>{
 const before=await db.workRecord.count({where:{workspace:'sandbox',kind:'operatingLedger'}});
 await page.goto('/?tab=fields&field='+pnu);const field=page.getByTestId('field-management');await expect(field).toBeVisible();await field.getByRole('tab',{name:'작업 이력',exact:true}).click();
 const ledger=page.getByTestId('field-operating-ledger');await expect(ledger).toBeVisible();await expect(ledger.getByText('출하 중량 확인 후 정정',{exact:true})).toBeVisible();await expect(ledger.getByRole('row').filter({hasText:'검증용 수확 작업비'})).toBeVisible();
 expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'operatingLedger'}})).toBe(before);
});
