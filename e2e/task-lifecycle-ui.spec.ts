import {test,expect} from './authenticated-test';
import type {State,Mission} from '../lib/types';
// Stable UI scenario; previous/today/next must share the displayed month.
// Cross-year navigation is covered by intake-live-db.spec.ts.
const today='2026-10-15',month=Number(today.slice(5,7));
const date=(n:number)=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function fixture(){
 const state:State={name:'계북면',planVersion:1,fields:[{id:'field',farmerId:'farmer',name:'홍확인',address:'계북면 농소리 616-4',area:1000,crop:'고추',mode:'완전 위탁형',access:true,water:true,confirmed:false,cluster:'',source:'DEMO_ASSUMPTION'}],machines:[{id:'JB23TR01',name:'트랙터',type:'트랙터',status:'AVAILABLE',safetyLock:false,capacityHaHour:1}],missions:[],events:[],revisions:[],registered:true,planned:true,ruleVersion:'TEST',transportCount:2,staffCount:2};
 const base:Mission={id:'',fieldId:'field',label:'',crop:'고추',scheduledDate:date(-1),month,status:'COMPLETED',resourceId:'JB23TR01',owner:'장비',start:0,duration:4,deadline:32,priority:1,batchKey:'test',staff:1,transport:1};
 state.missions=Array.from({length:7},(_,i)=>({...base,id:'done-'+i,label:'완료 작업 '+i}));
 state.missions.push({...base,id:'cancelled',label:'생략한 방제',status:'CANCELLED',cancellation:{requestId:'c',category:'UNNECESSARY',reason:'방제 불필요 확인',confirmedBy:'담당자',confirmedAt:date(-1)+'T09:00:00+09:00'}},{...base,id:'moved',label:'이동한 작업',status:'PLANNED',scheduledDate:date(1),originalScheduledDate:date(-1)},{...base,id:'missing',label:'결과 없는 작업',status:'PLANNED'});
 return state;
}
async function routes(page:any,state:State,records:any[]=[],approvals:any[]=[]){
 await page.clock.setFixedTime(new Date(today+'T03:00:00Z'));
 await page.route('**/api/workspace*',(r:any)=>r.fulfill({json:{state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/work-history',(r:any)=>r.fulfill({json:{items:records,changes:[],approvals}}));
 await page.route('**/api/execution-records',(r:any)=>r.fulfill({json:{history:[],snapshots:[]}}));
 await page.route('**/api/work-reports',(r:any)=>r.fulfill({json:{planVersion:state.planVersion,rows:state.missions.map(m=>({missionId:m.id,evidenceId:null}))}}));
 await page.route('**/api/weather',(r:any)=>r.fulfill({json:{status:'NOT_CONFIGURED'}}));
 await page.route('**/api/weather/forecast',(r:any)=>r.fulfill({json:{short:{status:'NOT_CONFIGURED',points:[]}}}));
}
test('daily totals follow moved work, preserve cancellation and put unresolved work in actionable results',async({page})=>{
 const s=fixture();await routes(page,s);
 const writes:any[]=[];await page.route('**/api/task-cancellations',async r=>{const b=r.request().postDataJSON();writes.push(b);const m=s.missions.find(m=>m.id===b.missionIds[0])!;m.status='CANCELLED';m.cancellation={requestId:b.requestId,category:b.category,reason:b.reason,confirmedAt:new Date().toISOString(),confirmedBy:'담당자'};s.planVersion++;await r.fulfill({json:{ok:true}})});
 await page.goto('/');const oldDay=page.getByTestId('calendar-day-'+date(-1));
 await expect(oldDay.locator('.calendar-task-count')).toHaveCount(3);await expect(oldDay).toContainText('완료작업 7');await expect(oldDay).not.toContainText('취소');await expect(oldDay).not.toContainText('확인 필요');await expect(oldDay).toContainText('예정작업 0');await expect(page.locator('.overdue-notice')).toHaveCount(0);
 await oldDay.click();const oldSchedule=page.getByTestId('schedule-day-'+date(-1));await expect(oldSchedule).toHaveAttribute('open','');await expect(oldSchedule).not.toContainText('이동한 작업');
 await oldSchedule.locator('tr').filter({hasText:'생략한 방제'}).getByRole('button',{name:'관리',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('방제 불필요 확인');await expect(page.getByRole('dialog').getByRole('button',{name:'작업취소',exact:true})).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByTestId('task-attention').getByRole('button',{name:'작업결과 미입력 1건',exact:true}).click();await expect(page.getByTestId('task-attention')).toContainText('결과 없는 작업');
 await page.getByTestId('task-attention').getByRole('button',{name:'작업취소',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'작업 취소 확정'})).toBeDisabled();await dialog.getByLabel('취소 사유',{exact:true}).fill('현장 확인 후 생략');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'작업 취소 확정'}).click();await expect(dialog).toHaveCount(0);
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({missionIds:['missing'],expectedPlanVersion:1,unperformedConfirmed:true});
 await expect(page.getByTestId('task-attention')).toHaveCount(0);await expect(page.getByTestId('schedule-day-'+date(-1))).toContainText('취소 2');
 await page.getByRole('navigation').getByRole('button',{name:'메인',exact:true}).click();await expect(page.getByTestId('calendar-day-'+date(-1))).toContainText('완료작업 7');await expect(page.getByTestId('calendar-day-'+date(1))).toContainText('예정작업 1');
 await page.screenshot({path:'test-results/task-lifecycle-main.png',fullPage:true});
});
test('result entry moves an unperformed past job to replanning instead of inventing completion',async({page})=>{
 const s=fixture(),records:any[]=[],writes:any[]=[];await routes(page,s,records);
 await page.route('**/api/execution-records',async r=>{if(r.request().method()==='GET')return r.fulfill({json:{history:[],snapshots:[]}});const b=r.request().postDataJSON();writes.push(b);s.missions.find(m=>m.id===b.input.missionId)!.status=b.input.status;s.planVersion++;records.push({missionId:'missing',source:'DEMO_SIMULATION',plannedDate:date(-1),assessment:'SIMULATED_HELD'});await r.fulfill({json:{item:{}}})});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();await page.getByTestId('task-attention').getByRole('button',{name:'작업결과 미입력 1건'}).click();await page.getByRole('button',{name:'결과 입력',exact:true}).click();
 await page.getByLabel('작업 결과',{exact:true}).selectOption('HELD');await page.getByLabel('결과 확인 내용',{exact:true}).fill('비로 작업하지 못함');await page.getByRole('button',{name:'작업결과 저장',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes[0].input).toMatchObject({status:'HELD',startedAt:null,finishedAt:null});await expect(page.getByTestId('task-attention')).toContainText('재배치 대기 1건');await page.getByRole('navigation').getByRole('button',{name:'메인',exact:true}).click();await expect(page.getByTestId('calendar-day-'+date(-1))).toContainText('완료작업 7');
});
test('a saved change proposal can be reviewed and approved without per-task approvals',async({page})=>{
 const s=fixture(),approvals:any[]=[{id:'proposal',missionIds:['missing'],day:date(-1),result:{proposalId:'proposal',status:'FEASIBLE',phase:'GAPS_ONLY',diff:[{id:'missing',before:0,after:32,date:date(1),beforeResource:'JB23TR01',afterResource:'JB23TR01'}],warnings:[]}}],calls:any[]=[];await routes(page,s,[],approvals);
 await page.route('**/api/replanning',async r=>{calls.push(r.request().postDataJSON());s.missions.find(m=>m.id==='missing')!.scheduledDate=date(1);s.planVersion++;approvals.splice(0);await r.fulfill({json:{ok:true}})});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();await page.getByTestId('task-attention').getByRole('button',{name:'변경계획 승인 대기 1건'}).click();await page.getByRole('button',{name:'변경계획 검토',exact:true}).click();await page.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls).toEqual([{action:'approve',proposalId:'proposal'}]);await expect(page.getByTestId('task-attention')).toHaveCount(0);await page.getByRole('navigation').getByRole('button',{name:'메인',exact:true}).click();await expect(page.getByTestId('calendar-day-'+date(1))).toContainText('예정작업 2');
});
