import {expect, it} from 'vitest';
import {buildAnnualPlan} from '../lib/annual-plan';
import {appendAssignments} from '../lib/plan-missions';
import type {previewAnnualDispatch} from '../lib/annual-dispatch';
import {splitGroup} from '../lib/split-work-area';
import {missionPacket} from '../lib/equipment-mission';
import type {WorkMission} from '../lib/replan-work-split';
import {catalogContext, catalogCycle, catalogField, catalogState} from './catalog-fixtures';
import {box} from './split-work-area-fixture';

function fixture() {
  const state = catalogState();
  state.machines = state.machines.map(m => m.id.includes('SE') ? {...m, capacityHaHour: 0.015} : m);
  const plan = buildAnnualPlan([catalogField('soybean', 2000)], 2034, 1, catalogContext(), catalogCycle('soybean'), undefined, state);
  const tasks = plan.plots[0].tasks.filter(t => t.operationCode === 'plant');
  expect(tasks).toHaveLength(2);
  // This unit fixture verifies persistence, not scheduling feasibility.
  const assignments = tasks.map((t, i) => ({
    taskId: t.id, operationKey: t.operationKey, pnu: plan.plots[0].pnu,
    date: `2034-05-0${i + 1}`, startMinute: 480, durationMinutes: 480,
    machineId: 'TESTSE01', owner: '장비', staff: 2, transport: 1,
    predecessorMissionIds: t.predecessorKeys, operatorIds: [],
  }));
  const dispatch = {assignments} as Awaited<ReturnType<typeof previewAnnualDispatch>>;
  return {state, plan, tasks, dispatch};
}

it('links every newly admitted part with stable IDs and recorded workload, without changing existing work', () => {
  const f = fixture(), before = structuredClone(f.state);
  const next = appendAssignments(f.state, f.plan, f.dispatch);
  const parts = next.missions as WorkMission[];
  expect(f.state).toEqual(before);
  const group = splitGroup(next, parts[0].equipmentSplit!.groupId);
  expect(group.members.map(m => m.id)).toEqual(f.tasks.map(t => t.id));
  expect(group.sourceId).toBe(f.tasks[0].id);
  expect(parts[0].splitChildIds).toEqual([f.tasks[1].id]);
  expect(parts.map(m => m.equipmentSplit!.part)).toEqual([1, 2]);
  expect(parts.reduce((n, m) => n + m.equipmentWork!.areaHa, 0)).toBeCloseTo(0.2);
  for (const [i, m] of parts.entries()) {
    expect(m.equipmentWork).toMatchObject({basis: 'PLAN_AREA_AND_SETUP', referenceMachineId: 'TESTSE01', referenceCapacityHaHour: 0.015, setupSlots: f.tasks[i].requirements.setupMinutes / 15});
    expect(m.workAreaM2).toBe(f.tasks[i].workAreaM2);
    expect(m.predecessorMissionIds).toEqual(f.tasks[i].predecessorKeys);
  }
  expect(appendAssignments(f.state, f.plan, {...f.dispatch, assignments: [...f.dispatch.assignments].reverse()}).missions.map(m => (m as WorkMission).equipmentSplit?.groupId))
    .toEqual(parts.map(m => m.equipmentSplit?.groupId));
  expect(() => appendAssignments(next, f.plan, f.dispatch)).toThrow('중복');
});

it('keeps repeated operation rounds in separate partition groups', () => {
  const f = fixture();
  const repeat = f.tasks.map(t => ({...structuredClone(t), id: t.id + ':round2', operationKey: t.operationKey + ':round2', occurrence: 2}));
  f.plan.plots[0].tasks = [...f.plan.plots[0].tasks, ...repeat] as typeof f.plan.plots[0]['tasks'];
  f.dispatch.assignments.push(...f.dispatch.assignments.map((a, i) => ({...a, taskId: repeat[i].id, operationKey: repeat[i].operationKey})));
  const next = appendAssignments(f.state, f.plan, f.dispatch);
  const groups = [...new Set((next.missions as WorkMission[]).map(m => m.equipmentSplit!.groupId))];
  expect(groups).toHaveLength(2);
  for (const id of groups) expect(splitGroup(next, id).members).toHaveLength(2);
});

it('cannot pass a full-field boundary to a partly admitted operation, including its large first piece', () => {
  const f = fixture();
  f.tasks[0].workAreaM2 = 1990; f.tasks[1].workAreaM2 = 10;
  const next = appendAssignments(f.state, f.plan, {...f.dispatch, assignments: [f.dispatch.assignments[0]]});
  const m = next.missions[0] as WorkMission;
  expect(m.equipmentSplit?.parts).toBe(2);
  expect(() => splitGroup(next, m.equipmentSplit!.groupId)).toThrow('불완전');
  const parent = {pnu: m.fieldId, geometry: box(), source: 'FIELD_SURVEY' as const, reviewedOn: '2026-10-01', accessAndExclusionsReviewed: true as const, machineAccessConfirmed: true, note: '격리 검증', version: 1, reviewedBy: 'tester'};
  const packet = missionPacket(next, 'demo', m.id, parent, [], '2026-10-04');
  expect(packet.data.workArea).toBeNull();
  expect(packet.blockers).toContain('SPLIT_WORK_AREA_REVIEW_REQUIRED');
});

it('does not rewrite a completed legacy piece or infer a review for remaining work', () => {
  const f = fixture();
  const prior = appendAssignments(f.state, f.plan, {...f.dispatch, assignments: [f.dispatch.assignments[0]]});
  const old = prior.missions[0] as WorkMission;
  delete old.equipmentSplit; delete old.splitChildIds; delete old.equipmentWork;
  old.status = 'COMPLETED';
  const saved = structuredClone(old);
  const next = appendAssignments(prior, f.plan, {...f.dispatch, assignments: [f.dispatch.assignments[1]]});
  expect(next.missions[0]).toEqual(saved);
  expect((next.missions[1] as WorkMission).equipmentSplit).toBeUndefined();
  expect(missionPacket(next, 'demo', next.missions[1].id, null, [], '2026-10-04').blockers).toContain('UNLINKED_WORK_PARTS');
});

it('preserves legacy part guards when a crop replacement suffix follows the part number', () => {
  const f = fixture(), next = appendAssignments(f.state, f.plan, f.dispatch);
  for (const [i, m] of (next.missions as WorkMission[]).entries()) {
    delete m.equipmentSplit; delete m.equipmentWork; delete m.workAreaM2;
    m.operationKey = `cultivation:old:soil${i ? ':part2' : ''}:replacement:abc`;
  }
  for (const m of next.missions) expect(missionPacket(next, 'demo', m.id, null, [], '2026-10-04').blockers).toContain('UNLINKED_WORK_PARTS');
});

it('does not group different fields, and requires explicit workloads for new equipment work', () => {
  const f = fixture();
  const other = structuredClone(f.plan.plots[0]); other.pnu = '5274036023900010002';
  other.tasks = other.tasks.map(t => ({...t, id: t.id + ':other', operationKey: t.operationKey + ':other'}));
  f.plan.plots.push(other);
  f.dispatch.assignments.push(...f.dispatch.assignments.map(a => ({...a, taskId: a.taskId + ':other', operationKey: a.operationKey + ':other', pnu: other.pnu})));
  const next = appendAssignments(f.state, f.plan, f.dispatch);
  const groups = [...new Set((next.missions as WorkMission[]).map(m => m.equipmentSplit!.groupId))];
  expect(groups).toHaveLength(2);
  expect(groups.map(g => splitGroup(next, g).fieldId).sort()).toEqual([f.plan.plots[0].pnu, other.pnu].sort());
  f.tasks[0].workAreaM2 = NaN;
  expect(() => appendAssignments(f.state, f.plan, f.dispatch)).toThrow('면적');
});
