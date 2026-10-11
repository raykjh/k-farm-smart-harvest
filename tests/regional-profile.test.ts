import {it,expect} from 'vitest';
import {buildAnnualPlan} from '../lib/annual-plan';
import {planningContext} from '../lib/planning-context';
const field={pnu:'4574034026106160004',address:'test',area:1000,crop:'rice' as const,mode:'joint' as const,group:'',rights:'pending' as const};
const profile={region:'계북면',version:'test-v1',sourceUrl:'https://www.nongsaro.go.kr/',reviewer:'test',reviewedOn:'2026-09-18',validFrom:'2026-01-01',validUntil:'2026-12-31',station:'ASOS248',normalPeriod:'1991-2020',varieties:{rice:'test variety'}};
it('retains regional source/version and different regional anchors generate different schedules',()=>{
 const a=planningContext.parse({region:'계북면',regionalProfile:profile,anchors:{rice:{planting:'2026-05-20'}}});
 const p=buildAnnualPlan([field],2026,1,a);expect(p.plots[0].regionalProfile?.version).toBe('test-v1');
 const b=buildAnnualPlan([field],2026,1,{...a,region:'다른 지역',regionalProfile:{...profile,region:'다른 지역'},anchors:{rice:{planting:'2026-05-10'}}});
 expect(p.plots[0].tasks.find(t=>t.operationCode==='plant')!.date).not.toBe(b.plots[0].tasks.find(t=>t.operationCode==='plant')!.date);
});
it('rejects wrong-region and out-of-validity work criteria',()=>{
 expect(()=>buildAnnualPlan([field],2026,1,{region:'다른 지역',regionalProfile:profile})).toThrow('지역');
 expect(()=>buildAnnualPlan([field],2027,1,{regionalProfile:profile,anchors:{rice:{planting:'2027-05-20'}}})).toThrow('유효기간');
});
