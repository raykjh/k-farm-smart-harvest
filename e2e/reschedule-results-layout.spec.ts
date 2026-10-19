import {test,expect} from './authenticated-test';
import {emptyCenter} from '../lib/center-registry';
import type {Mission} from '../lib/types';

for(const screen of ['desktop','mobile'] as const)for(const entry of ['daily','task'] as const)test(`${screen} ${entry}: 300 change rows keep Done accessible`,async({page},info)=>{
 if(screen==='mobile')await page.setViewportSize({width:390,height:844});
 const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),state=emptyCenter('demo');
 const task={id:'layout-task',fieldId:'layout-field',crop:'쌀',label:'벼 수확',owner:'장비',resourceId:'JB23CB01',status:'PLANNED',start:0,duration:4,deadline:32,priority:1,staff:1,transport:1,scheduledDate:day,month:Number(day.slice(5,7)),batchKey:'layout'} as Mission;
 state.fields=[{id:task.fieldId,farmerId:'owner',name:'홍가상',address:'화면 검증 농지',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'layout',source:'DEMO_ASSUMPTION'}];state.missions=[task];
 const rows=Array.from({length:300},(_,i)=>({id:'changed-'+i,field:'화면 검증 농지 '+(i+1),crop:'쌀',task:'벼 수확',before:{date:day,resource:'콤바인 1호',resourceId:'JB23CB01',minutes:60,startMinute:480},after:{date:day,resource:'콤바인 2호',resourceId:'JB23CB02',minutes:60,startMinute:480},changed:['equipment']}));
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/work-history',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/api/continuous-production',r=>r.fulfill({json:{view:{items:[]}}}));
 await page.route('**/api/replanning',r=>r.fulfill({json:r.request().method()==='POST'?{status:'APPLIED',requestId:'layout',changes:300,changeRows:rows}:{items:[]}}));
 await page.goto('/?tab=schedule');const daily=page.getByTestId('schedule-day-'+day);await expect(daily).toBeVisible();
 if(await daily.getAttribute('open')===null)await daily.locator('summary').click();
 if(entry==='daily'){await daily.getByRole('button',{name:'전체 선택',exact:true}).click();await daily.getByRole('button',{name:'일정변경',exact:true}).click()}
 else await daily.getByRole('button',{name:'관리',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('변경 사유를 선택해주세요',{exact:true}).selectOption('기타 변경');
 await dialog.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();
 const result=dialog.getByTestId('automatic-replan-applied'),list=result.locator('.table-wrap');
 await expect(result).toBeVisible();await expect(list.locator('tbody tr')).toHaveCount(300);
 await expect(result.getByRole('button',{name:'완료',exact:true})).toBeInViewport();
 expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight>0)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('results.png')});
 await result.getByRole('button',{name:'완료',exact:true}).click();await expect(dialog).toHaveCount(0);
});
