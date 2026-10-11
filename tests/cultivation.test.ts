import {it,expect} from 'vitest';
import {checkCultivation,type Cultivation} from '../lib/cultivation';
import {buildAnnualPlan} from '../lib/annual-plan';
import {planFieldsCurrent} from '../lib/planning-fields';
const c:Cultivation={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',pnu:'5274036023106160004',crop:'potato',start:'2026-12-01',end:'2027-07-01',source:'REGISTERED'};
it('keeps cultivation task identities across a calendar year boundary',()=>{
 const field={pnu:c.pnu,address:'test',area:1000,crop:c.crop,group:'',mode:'full' as const,rights:'pending' as const};
 const p=buildAnnualPlan([field],2026,1,{anchors:{potato:{planting:'2027-03-01'}}},c);
 expect(p.plots[0].tasks.find(t=>t.operationCode==='plant')!.date).toBe('2027-03-01');
 expect(p.plots[0].tasks.every(t=>t.operationKey.startsWith('cultivation:'+c.id))).toBe(true);
 expect(buildAnnualPlan([field],2027,1,{anchors:{potato:{planting:'2027-03-01'}}},c).plots[0].tasks.map(t=>t.id)).toEqual(p.plots[0].tasks.map(t=>t.id));
});
it('does not invalidate a cultivation when another farmer registers, but detects its area change',()=>{
 const f={pnu:c.pnu,address:'test',area:1000,crop:c.crop,group:'',mode:'full' as const,rights:'pending' as const};
 const p=buildAnnualPlan([f],2026,1,{},c);
 expect(planFieldsCurrent(p,2,[f,{...f,pnu:'5274036023102760001'}])).toBe(true);
 expect(planFieldsCurrent(p,2,[{...f,area:2000}])).toBe(false);
});
it('rejects overlap and permits a subsequent non-overlapping cultivation',()=>{
 expect(()=>checkCultivation({...c,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},[c])).toThrow('겹칩니다');
 expect(()=>checkCultivation({...c,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',start:'2027-07-02',end:'2027-12-01',previousId:c.id},[c])).not.toThrow();
});
