import {it,expect} from 'vitest';
import {draftWorkPartition,validateWorkGeometry,validateWorkPartition} from '../lib/work-area-geometry';
import {resolveSplitArea,validateSplitReview,splitGroup} from '../lib/split-work-area';
import {missionPacket} from '../lib/equipment-mission';
import {box,splitWorkAreaFixture} from './split-work-area-fixture';
const today='2026-10-03';
it('assigns only each reviewed sub-polygon and never silently sends the entire field',()=>{
 const f=splitWorkAreaFixture();
 for(const m of f.parts){
  const blocked=missionPacket(f.state,'demo',m.id,f.area,f.reservations,today);expect(blocked.ready).toBe(false);expect(blocked.data.workArea).toBeNull();
  const packet=missionPacket(f.state,'demo',m.id,f.area,f.reservations,today,[f.saved]);expect(packet.blockers).toEqual([]);expect(packet.ready).toBe(true);expect(packet.data.workArea!.geometry).toEqual(f.input.parts.find(p=>p.missionId===m.id)!.geometry);expect(packet.data.workArea!.geometry).not.toEqual(f.area.geometry);expect(packet.data.splitArea?.reviewRequired).toBe(false);expect(packet.data.executionAuthorized).toBe(false);
 }
});
it('rejects overlap, gap, outside areas, duplicate/missing/foreign parts and wrong work proportions',()=>{
 const f=splitWorkAreaFixture(),geos=f.input.parts.map(p=>p.geometry),weights=[1,1];
 expect(()=>validateWorkPartition(f.area.geometry,[geos[0],geos[0]],weights)).toThrow('겹칩니다');
 expect(()=>validateWorkPartition(f.area.geometry,[box(127,35,127.0004,35.001),geos[1]],weights)).toThrow('남아');
 expect(()=>validateWorkPartition(f.area.geometry,[box(127,35,127.0004,35.001),box(127.0004,35,127.001,35.001)],weights)).toThrow('작업량');
 expect(()=>validateWorkPartition(f.area.geometry,[geos[0],box(127.0005,35,127.002,35.001)],weights)).toThrow('벗어나');
 for(const parts of [[f.input.parts[0]],f.input.parts.map(()=>f.input.parts[0]),[f.input.parts[0],{...f.input.parts[1],missionId:'foreign'}]])expect(()=>validateSplitReview(f.state,f.groupId,f.area,{...f.input,parts},today)).toThrow('하나씩');
});
it('rejects self intersections, invalid holes, nested holes, degenerate and overlapping multipolygons',()=>{
 const square=box(),ring=square.type==='Polygon'?square.coordinates[0]:[];
 for(const g of [
  {type:'Polygon',coordinates:[[[127,35],[127.001,35.001],[127,35.001],[127.001,35],[127,35]]]},
  {type:'Polygon',coordinates:[ring,[[128,35],[128.001,35],[128.001,35.001],[128,35]]]},
  {type:'Polygon',coordinates:[[[127,35],[127.001,35],[127.002,35],[127,35]]]},
  {type:'MultiPolygon',coordinates:[[ring],[ring]]},
  {type:'Polygon',coordinates:[ring,[[127.0001,35.0001],[127.0009,35.0001],[127.0009,35.0009],[127.0001,35.0001]],[[127.0002,35.0002],[127.0003,35.0002],[127.0003,35.0003],[127.0002,35.0002]]]},
 ])expect(()=>validateWorkGeometry(g)).toThrow();
});
it('drafts concave and disconnected areas with exclusion holes in either direction without saving',()=>{
 const parent={type:'MultiPolygon' as const,coordinates:[
  [[[127,35],[127.004,35],[127.004,35.001],[127.002,35.001],[127.002,35.004],[127,35.004],[127,35]],[[127.0005,35.0005],[127.001,35.0005],[127.001,35.001],[127.0005,35.001],[127.0005,35.0005]]],
  [[[127.005,35],[127.006,35],[127.006,35.001],[127.005,35.001],[127.005,35]]],
 ] as [number,number][][][]};
 for(const axis of ['EW','NS'] as const){const parts=draftWorkPartition(parent,[1,2,1],axis),r=validateWorkPartition(parent,parts,[1,2,1]);expect(r.parts.map(p=>p.share)).toEqual([expect.closeTo(.25,5),expect.closeTo(.5,5),expect.closeTo(.25,5)]);}
 const holeParent={type:'Polygon' as const,coordinates:parent.coordinates[0]};expect(()=>validateWorkPartition(holeParent,[box(127,35,127.002,35.004),box(127.002,35,127.004,35.001)],[1,1])).toThrow('제외구역');
});
it('invalidates area/workload/member changes, but retains geometry across dates and completion',()=>{
 const f=splitWorkAreaFixture(),resolve=()=>resolveSplitArea(f.state,f.groupId,f.area,f.saved,today);
 expect(resolve().ready).toBe(true);f.state.planVersion++;f.parts[0].scheduledDate='2032-09-03';expect(resolve().ready).toBe(true);
 f.parts[0].status='COMPLETED';expect(resolve().ready).toBe(true);expect(splitGroup(f.state,f.groupId).editable).toBe(true);
 f.area.version++;expect(resolve().ready).toBe(false);f.area.version--;
 (f.parts[1] as any).equipmentWork.areaHa*=2;expect(resolve().ready).toBe(false);(f.parts[1] as any).equipmentWork.areaHa/=2;
 f.state.missions=f.state.missions.filter(m=>m.id!==f.parts[1].id);expect(resolve().ready).toBe(false);
});
it('rechecks field review dates, access and cancellation and bounds geometry size',()=>{
 const f=splitWorkAreaFixture();
 expect(()=>validateSplitReview(f.state,f.groupId,{...f.area,machineAccessConfirmed:false},f.input,today)).toThrow('현장 확인');
 expect(()=>validateSplitReview(f.state,f.groupId,f.area,{...f.input,reviewedOn:'2026-09-30'},today)).toThrow('확인일');
 expect(()=>validateSplitReview(f.state,f.groupId,f.area,{...f.input,reviewedOn:'2099-01-01'},today)).toThrow('확인일');
 f.parts[0].status='CANCELLED';expect(resolveSplitArea(f.state,f.groupId,f.area,f.saved,today).ready).toBe(false);
 expect(()=>validateWorkGeometry(box(127,35,128,36))).toThrow('검토 범위');
});
it('requires re-planning when total reviewed area differs materially from approved workload',()=>{
 const f=splitWorkAreaFixture();f.parts.forEach(m=>(m as any).equipmentWork.areaHa*=3);
 expect(()=>validateSplitReview(f.state,f.groupId,f.area,f.input,today)).toThrow('5%');
});
it('prevents regeneration after execution begins and invalidates safety, reservation or geometry changes',()=>{
 const f=splitWorkAreaFixture(),packet=()=>missionPacket(f.state,'demo',f.parts[0].id,f.area,f.reservations,today,[f.saved]);
 const before=packet();(f.parts[0] as any).executionStartedAt='2032-09-01T08:00:00+09:00';expect(packet().ready).toBe(false);delete (f.parts[0] as any).executionStartedAt;
 f.state.machines[0].safetyLock=true;expect(packet().ready).toBe(false);f.state.machines[0].safetyLock=false;
 f.reservations.splice(0,1);expect(packet().blockers).toContain('MATCHING_RESERVATION_REQUIRED');expect(packet().fingerprint).not.toBe(before.fingerprint);
});
it('does not send whole-field geometry for older partial work without explicit split identity',()=>{
 const f=splitWorkAreaFixture();for(const m of f.parts)delete (m as any).equipmentSplit;
 const r=missionPacket(f.state,'demo',f.parts[0].id,f.area,f.reservations,today);expect(r.ready).toBe(false);expect(r.data.workArea).toBeNull();expect(r.blockers).toContain('UNLINKED_WORK_PARTS');
 for(const m of f.parts)delete (m as any).workAreaM2;
 (f.parts[0] as any).operationKey='c:soil';(f.parts[1] as any).operationKey='c:soil:part2';
 expect(missionPacket(f.state,'demo',f.parts[0].id,f.area,f.reservations,today).blockers).toContain('UNLINKED_WORK_PARTS');
});
it('keeps a current correction token when an existing area review needs repair',()=>{
 const f=splitWorkAreaFixture();f.saved.parts[1].geometry=f.saved.parts[0].geometry;
 const review=resolveSplitArea(f.state,f.groupId,f.area,f.saved,today);expect(review.ready).toBe(false);expect(review.reviewFingerprint).toMatch(/^[a-f0-9]{64}$/);
});
