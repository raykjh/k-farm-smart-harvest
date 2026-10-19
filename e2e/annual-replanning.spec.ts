import {test,expect} from './authenticated-test';
import type {State} from '../lib/types';
import {comparedPlans} from './replan-responses';

test('daily selection compares and reviews a batch without applying it',async({page})=>{
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const s:State={name:'계북면',planVersion:1,fields:[{id:'field',farmerId:'farmer',name:'홍검증',address:'계북면 농소리',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:false,cluster:'',source:'DEMO_ASSUMPTION'}],machines:[{id:'JB23TR01',name:'트랙터',type:'트랙터',status:'AVAILABLE',safetyLock:false,capacityHaHour:1}],missions:[],events:[],revisions:[],registered:true,planned:true,ruleVersion:'UI_TEST',transportCount:2,staffCount:2};
 s.missions=[0,1].map(i=>({id:'batch-'+i,fieldId:'field',label:'쌀 작업',crop:'쌀',scheduledDate:today,month:Number(today.slice(5,7)),status:'PLANNED',resourceId:'JB23TR01',owner:'장비',start:i*4,duration:4,deadline:32,priority:1,batchKey:'batch',staff:1,transport:1}));
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state:s,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/work-history',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'NOT_CONFIGURED'}}));
 await page.route('**/api/weather/forecast',r=>r.fulfill({json:{short:{status:'NOT_CONFIGURED',points:[]}}}));
 const calls:any[]=[];let compared:any;
 await page.route('**/api/replanning',async r=>{
  const input=r.request().postDataJSON();calls.push(input);
  if(input.action==='compare'){compared=comparedPlans(input);await r.fulfill({json:compared})}
  else await r.fulfill({json:{...compared.results[1].result,proposalId:'00000000-0000-4000-8000-000000000001'}});
 });
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();
 const day=page.getByTestId('schedule-day-'+today);await day.getByRole('button',{name:'전체 선택'}).click();await day.getByRole('button',{name:'일정변경',exact:true}).click();
 await page.getByRole('button',{name:'일정변경 진행',exact:true}).click();
 const panel=page.getByRole('region',{name:'작업 관리',exact:true});
 await panel.getByLabel('변경 사유',{exact:true}).fill('당일 미완료 작업 재배치');await panel.getByRole('button',{name:'자동 재배치 계산',exact:true}).click();
 await expect(panel.locator('.replan-option')).toHaveCount(3);expect(calls[0].day).toBe(today);expect(calls[0].deferAfter).toBe(today);expect(calls[0].searchMode).toBe('LOCAL_FIRST');expect(calls[0].ids).toHaveLength(2);expect(calls[0]).not.toHaveProperty('preferred');
 await panel.getByText('계산 대안 상세',{exact:true}).click();
 await panel.getByRole('button',{name:'충돌 관련 일정 재배치 · 선택',exact:true}).click();
 await expect(panel.getByRole('button',{name:/변경계획 일괄 승인/})).toBeEnabled();expect(calls.map(c=>c.action)).toEqual(['compare','preview']);
 expect(calls[1].decisionSource).toBe('DEVELOPMENT_REVIEW');
});
