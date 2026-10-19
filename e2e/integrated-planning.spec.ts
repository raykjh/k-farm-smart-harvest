import {test,expect} from './authenticated-test';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal} from '../lib/integrated-plan';
import {jointPublicView} from '../lib/integrated-plan-service';
import {jointSource} from '../tests/integrated-plan-fixture';

test('joint plan presents crop, resources and comparisons without implicit inference; mobile fits',async({page})=>{
 const snapshot=await collectJointSnapshot([jointSource()],['demo']),selected=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));
 const item=jointPublicView({input:{requestId:'10000000-0000-4000-8000-000000000001',audience:'demo'},status:'READY',source:'RULES',fingerprint:snapshot.fingerprint,selected,baseline:selected,remaining:0,excluded:[]},snapshot.fingerprint),actions:string[]=[];
 let legacy=false;const old=structuredClone(item);
 for(const key of ['supplyRiskFields','unassessedMarketFields','establishedSpecialtyFields','neighborCompatibleFields','specialtyTrialFields'])for(const part of ['selected','baseline'])delete (old as any)[part].metrics[key];
 await page.route('**/api/integrated-planning',async route=>{
  const request=route.request();if(request.method()==='GET')return route.fulfill({json:{canPlan:true,canStage:true,items:legacy?[old]:[]}});
  const b=request.postDataJSON();actions.push(b.action+':'+(b.mode??''));
  return route.fulfill({json:b.action==='stage'?{view:{}}:{item:{...item,source:b.mode==='AI'?'NEBIUS':'RULES',decision:b.mode==='AI'?{model:'UI_FIXTURE_NOT_INFERENCE',usage:[{callId:'fixture-1'},{callId:'fixture-2'}],evidence:{tradeoffs:[]}}:null}}});
 });
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});await page.goto('/crop-info?tab=capacity');
 const panel=page.getByRole('region',{name:'작물·자원 통합계획',exact:true});
 await expect(panel.getByRole('button',{name:'AI 통합계획',exact:true})).toBeVisible();expect(actions).toEqual([]);
 await panel.getByRole('button',{name:'계산 기준 확인',exact:true}).click();await expect(panel).toContainText('계산 시점의 검토안');
 await panel.getByRole('tab',{name:'자원 확보안',exact:true}).click();await expect(panel).toContainText('일용 반일 인원 합계');await expect(panel).toContainText('필요 대수 하한');
 await panel.getByRole('tab',{name:'비교 결과',exact:true}).click();await expect(panel).toContainText('동일 입력 계산 기준');
 await expect(panel.getByRole('row').filter({hasText:'수확기 수급 전망 미확인'})).toContainText(String(selected.metrics.unassessedMarketFields));
 await panel.getByRole('button',{name:'AI 통합계획',exact:true}).click();await expect(panel).toContainText('AI 검토');
 await expect(panel).toContainText('실제 호출 2');await expect(panel).toContainText('비교 지표는 기준안과 같습니다.');
 await panel.getByRole('button',{name:'센터 계획 검토 목록에 반영',exact:true}).click();await expect(panel.getByText(/관리농지의 AI 계획·일괄 확정에서 계획을 확인 후 확정하세요/)).toBeVisible();
 expect(actions).toEqual(['plan:RULES','plan:AI','stage:']);
 await panel.screenshot({path:'.data/verification/integrated-plan-desktop.png'});
 await page.setViewportSize({width:390,height:844});await panel.getByRole('tab',{name:'자원 확보안',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await panel.screenshot({path:'.data/verification/integrated-plan-mobile.png'});
 legacy=true;await page.reload();await panel.getByRole('tab',{name:'비교 결과',exact:true}).click();
 await expect(panel.getByRole('row').filter({hasText:'수확기 수급 전망 미확인'}).getByRole('cell').nth(1)).toHaveText('—');
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(page.getByRole('region',{name:'Integrated crop and resource plan'})).toContainText('Unassessed harvest-market outlook');
 expect(errors).toEqual([]);
});

test('stale or unverified drafts cannot masquerade as a current AI review; read-only polling discovers a new plan',async({page})=>{
 await page.clock.install();
 const snapshot=await collectJointSnapshot([jointSource()],['demo']),selected=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));
 const raw={input:{requestId:'10000000-0000-4000-8000-000000000002',audience:'demo'},status:'READY',source:'NEBIUS',fingerprint:snapshot.fingerprint,selected,baseline:selected,remaining:0,excluded:[]};
 let current=false,gets=0;const mutations:string[]=[];
 await page.route('**/api/integrated-planning',async route=>{
  if(route.request().method()!=='GET'){mutations.push(route.request().method());return route.fulfill({status:409,json:{error:'No mutation expected'}})}
  gets++;return route.fulfill({json:{canPlan:true,canStage:true,items:[jointPublicView(raw,current?snapshot.fingerprint:'changed')]}});
 });
 await page.goto('/crop-info?tab=capacity');await page.getByLabel('언어 / Language').selectOption('en');
 const panel=page.getByRole('region',{name:'Integrated crop and resource plan'});
 await expect(panel).toContainText('The previous plan cannot be applied.');
 await expect(panel.getByText('AI reviewed',{exact:true})).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'Stage for center review'})).toHaveCount(0);
 current=true;
 // Clock advances only the browser refresh timer, never the application date/DB.
 await page.clock.fastForward(61000);
 await expect(panel.getByRole('button',{name:'Stage for center review'})).toBeEnabled();
 await expect(panel.getByText('AI reviewed',{exact:true})).toBeVisible();
 expect(gets).toBeGreaterThan(1);expect(mutations).toEqual([]);
});
