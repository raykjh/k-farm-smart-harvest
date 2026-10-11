import {it,expect} from 'vitest';
import {splitWorkAreaFixture} from './split-work-area-fixture';
import {splitReplanWork,type WorkMission} from '../lib/replan-work-split';
import {splitGroup,draftSplitReview,validateSplitReview,resolveSplitArea,splitReviewFingerprint} from '../lib/split-work-area';
import {calculateAnnualReplan,prepareAnnualReplan,verifyAssignments} from '../lib/annual-replanning';
const weather={status:'NOT_CONFIGURED',kind:'short',sourceUrl:'test',points:[]} as any;
function fixture(){
 const f=splitWorkAreaFixture();f.state.machines[0].capacityHaHour=0.04;
 f.parts.forEach(m=>{(m as WorkMission).planningWindow!.duration=m.duration});
 f.parts[0].status='COMPLETED';
 return f;
}
it('resplits remaining workload with current solver without modifying the completed piece',async()=>{
 const f=fixture(),finished=structuredClone(f.parts[0]),before=structuredClone(f.state),id=f.parts[1].id;
 const r=await calculateAnnualReplan(f.state,{ids:[id],scope:'PRESERVE'},weather,'2032-09-02');
 expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');expect(r.workSplit[0].partIds).toHaveLength(2);
 const prepared=prepareAnnualReplan(f.state,{ids:[id],scope:'PRESERVE'},weather,'2032-09-02',true);
 verifyAssignments(prepared.contract,r.assignments,r.phase!);
 expect(prepared.state.missions.find(m=>m.id===finished.id)).toEqual(finished);
 expect(f.state).toEqual(before);expect(r.diff.some(d=>d.id===finished.id)).toBe(false);
 expect(r.diff.find(d=>d.added)?.sourceId).toBe(id);
 const group=splitGroup(prepared.state,f.groupId);expect(group.members).toHaveLength(3);
 expect(group.members.reduce((n,m)=>n+m.equipmentWork!.areaHa,0)).toBeCloseTo(1);
 expect(group.members.map(m=>m.equipmentSplit!.part)).toEqual([1,2,3]);
 const corrupt=structuredClone(prepared.state);(corrupt.missions.find(m=>m.id===finished.id) as WorkMission).equipmentSplit!.parts=0;
 expect(()=>splitGroup(corrupt,f.groupId)).toThrow('불완전');
 expect((prepared.state.missions.find(m=>m.id===id) as WorkMission).equipmentWork!.areaHa).toBeCloseTo(.25);
});
it('drafts only the remaining footprint and rejects changes to completed reviewed geometry',()=>{
 const f=fixture(),next=splitReplanWork(f.state,{ids:[f.parts[1].id]},'2032-09-02').state;
 expect(resolveSplitArea(next,f.groupId,f.area,f.saved,'2026-10-04').ready).toBe(false);
 const group=splitGroup(next,f.groupId),parts=draftSplitReview(next,f.groupId,f.area,f.saved,'NS');
 expect(parts[0]).toEqual(f.saved.parts[0].geometry);
 const input={...f.input,reviewedOn:'2026-10-04',parts:group.members.map((m,i)=>({missionId:m.id,geometry:parts[i]}))};
 expect(()=>validateSplitReview(next,f.groupId,f.area,input,'2026-10-04',f.saved)).not.toThrow();
 const saved={...f.saved,...input,version:2,reviewFingerprint:splitReviewFingerprint(next,f.groupId,f.area)};
 expect(resolveSplitArea(next,f.groupId,f.area,saved,'2026-10-04').ready).toBe(true);
 input.parts[0].geometry=parts[1];
 expect(()=>validateSplitReview(next,f.groupId,f.area,input,'2026-10-04',f.saved)).toThrow('완료된');
 expect(()=>draftSplitReview(next,f.groupId,f.area,null,'EW')).toThrow('기존 확인 구역');
});
it('keeps all existing IDs and rewires successors when an unstarted earlier piece is split',()=>{
 const f=fixture();f.parts[0].status='PLANNED';
 const next=splitReplanWork(f.state,{ids:[f.parts[0].id]},'2032-09-01');
 const group=splitGroup(next.state,f.groupId);
 expect(group.members).toHaveLength(3);
 expect(group.members[2].id).toBe(f.parts[1].id);
 expect(group.members[2].predecessorMissionIds).toEqual([next.splits[0].partIds[1]]);
 expect(next.input.ids).toContain(f.parts[1].id);
 f.parts[1].status='COMPLETED';
 expect(()=>splitReplanWork(f.state,{ids:[f.parts[0].id]},'2032-09-01')).toThrow('뒤쪽 완료');
});
