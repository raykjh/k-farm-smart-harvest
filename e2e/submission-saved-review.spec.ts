import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {aiBudgetDb} from '../lib/ai-budget-ledger';

// Presentation check of a retained real-call result, not another live decision.
// Run after submission-journey-live-db, never seed or replay inference here.
test.skip(process.env.KFARM_SUBMISSION_SAVED_REVIEW!=='1','Retained live-run presentation review only');
test('saved actual AI comparison remains readable without another model call',async({page,context})=>{
 if(process.env.DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e'||process.env.AI_BUDGET_DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm')throw Error('Isolated data and original ledger required');
 const row=await db.workRecord.findFirstOrThrow({where:{workspace:'sandbox',kind:'integratedPlan'},orderBy:{updatedAt:'desc'}}),saved:any=row.payload;
 expect(saved.source).toBe('NEBIUS');expect(saved.decision.usage.length).toBeGreaterThan(0);
 const calls=await aiBudgetDb().aiCall.count();
 await context.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:3100'?r.continue():r.abort());
 await page.setViewportSize({width:1440,height:1050});await page.goto('/?tab=fields&section=production');
 const panel=page.getByRole('region',{name:'작물·자원 통합계획',exact:true});
 await panel.getByRole('tab',{name:'비교 결과',exact:true}).click();
 await expect(panel).toContainText(`실제 호출 ${saved.decision.usage.length}`);
 if(Object.keys(saved.selected.metrics).every(k=>saved.selected.metrics[k]===saved.baseline.metrics[k]))await expect(panel).toContainText('비교 지표는 기준안과 같습니다.');
 if(saved.decision.evidence.tradeoffs.length){await panel.getByText('AI가 확인한 다른 구성안',{exact:true}).click();await expect(panel).toContainText('확인 지표')}
 await panel.screenshot({path:'.data/verification/submission-journey/saved-actual-ai-comparison.png'});
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();await page.getByLabel('언어 / Language').selectOption('en');await page.getByRole('button',{name:'AI planning / batch approval',exact:true}).click();await page.setViewportSize({width:430,height:932});
  const english=page.getByRole('region',{name:'Integrated crop and resource plan',exact:true});
  await english.getByRole('tab',{name:'Comparison',exact:true}).click();await expect(english).toContainText('AI review complete');await expect(english).toContainText('Actual calls');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await english.screenshot({path:'.data/verification/submission-journey/saved-actual-ai-comparison-en.png'});
 expect(await aiBudgetDb().aiCall.count()).toBe(calls);
});
