import {createHash} from 'node:crypto';
import type {AnnualPlan} from './annual-plan';
import type {previewAnnualDispatch} from './annual-dispatch';
import {cropNames, type SupportedCropCode} from './crop-registry';
import {connectPlanningFields} from './planning-fields';
import {operatingTaskCrew} from './planned-labor-demand';
import {equipmentWork} from './replan-resource-options';
import type {WorkMission} from './replan-work-split';
import type {State} from './types';

type Dispatch = Awaited<ReturnType<typeof previewAnnualDispatch>>;
type Task = AnnualPlan['plots'][number]['tasks'][number];

/** Attach geometry-review identities only to newly admitted work. Historical
 * rows, including completed pieces of an enlarged field, are never migrated here.
 * A partial admission still carries its expected group size and stays blocked
 * at the packet boundary until all pieces have a valid reviewed partition. */
function linkNewWorkParts(state: State, plan: AnnualPlan, created: Set<string>) {
  const missions = new Map((state.missions as WorkMission[]).map(m => [m.id, m]));
  for (const plot of plan.plots) {
    const groups = new Map<string, Task[]>();
    for (const task of plot.tasks) {
      if (!task.requirements.machineCode) continue;
      const key = JSON.stringify([task.cultivationId, task.operationCode, task.occurrence]);
      const members = groups.get(key) ?? [];
      members.push(task);
      groups.set(key, members);
    }
    for (const tasks of groups.values()) {
      if (tasks.length < 2 || !tasks.some(t => created.has(t.id))) continue;
      // A task's stored part ordinal may have gaps after a completed-area change.
      // Such changes need an explicit historical-area review, not renumbering.
      const ordered = [...tasks].sort((a, b) => a.part - b.part);
      if (ordered.some((t, i) => t.part !== i + 1 || !Number.isFinite(t.workAreaM2) || t.workAreaM2 <= 0)) continue;
      if (ordered.some(t => missions.has(t.id) && !created.has(t.id))) continue;
      if (Math.abs(ordered.reduce((sum, t) => sum + t.workAreaM2, 0) - plot.area) > 0.01) continue;
      const sourceId = ordered[0].id;
      const groupId = createHash('sha256').update(JSON.stringify({
        contract: 'initial-work-partition-v1', pnu: plot.pnu, crop: plot.crop,
        members: ordered.map(t => [t.id, t.operationCode, t.occurrence, t.workAreaM2, t.requirements.setupMinutes]),
      })).digest('hex').slice(0, 24);
      for (const [index, task] of ordered.entries()) {
        const mission = missions.get(task.id);
        if (!mission || !created.has(task.id)) continue;
        if (mission.owner !== '장비' || !mission.equipmentWork) throw Error('신규 분할 작업의 장비·작업량 연결을 확인하세요.');
        mission.equipmentSplit = {groupId, sourceId, part: index + 1, parts: ordered.length};
        if (index === 0) mission.splitChildIds = ordered.slice(1).map(t => t.id);
      }
    }
  }
}

/** One persistence shape for individual admission, delegated admission and
 * cultivation changes. Does not approve, reserve or alter pre-existing work. */
export function appendAssignments(state: State, plan: AnnualPlan, dispatch: Dispatch, names: Record<string, string> = {}) {
  const next = connectPlanningFields(plan, state);
  const created = new Set<string>();
  for (const plot of plan.plots) {
    const field = next.fields.find(f => f.id === plot.pnu)!;
    if (plot.consultationId) {
      field.farmerId = plot.consultationId;
      field.name = names[plot.consultationId] ?? field.name;
    }
  }
  for (const a of dispatch.assignments) {
    if (next.missions.some(m => m.id === a.taskId)) throw Error('기존 작업 식별자와 중복됩니다. 최신 계획으로 다시 계산하세요.');
    const plot = plan.plots.find(p => p.pnu === a.pnu);
    const task = plot?.tasks.find(t => t.id === a.taskId);
    if (!plot || !task?.window) throw Error('배차와 계획 작업의 연결을 확인하세요.');
    const mission: WorkMission = {
      ...operatingTaskCrew(task),
      ...(a.operatorIds ? {operatorIds: a.operatorIds} : {}),
      ...(a.laborSupportIds ? {laborSupportIds: a.laborSupportIds} : {}),
      id: a.taskId, fieldId: a.pnu, crop: cropNames[plot.crop as SupportedCropCode], label: task.name,
      scheduledDate: a.date, month: Number(a.date.slice(5, 7)), owner: a.owner, status: 'PLANNED', resourceId: a.machineId,
      start: Math.round((Date.parse(a.date) - Date.parse('2026-09-09')) / 86400000) * 32 + (a.startMinute - 480) / 15,
      duration: a.durationMinutes / 15,
      deadline: Math.round((Date.parse(task.window.to) - Date.parse('2026-09-09')) / 86400000) * 32 + 32,
      priority: 5, batchKey: a.taskId, staff: a.staff, transport: a.transport,
      workAreaM2: task.workAreaM2 ?? plot.area, setupMinutes: task.requirements.setupMinutes,
      ...{
        ...('compatibilityCrop' in task && task.compatibilityCrop ? {compatibilityCrop: plot.crop as SupportedCropCode} : {}),
        executionReviewRequired: !!plot.environmental || ('executionReviewRequired' in task && !!task.executionReviewRequired),
        environmentReference: plot.environmental ?? null,
        cultivationId: task.cultivationId, operationKey: a.operationKey, operationCode: task.operationCode,
        occurrence: task.occurrence, predecessorMissionIds: a.predecessorMissionIds,
        planningWindow: {
          ...task.window, allowedWindows: task.allowedWindows ?? null,
          environmentRule: plot.environmental?.operations.find(o => o.code === task.operationCode)?.rule ?? null,
          growthReview: plan.environmentReview, duration: a.durationMinutes / 15,
          windLimitMs: task.requirements.windLimitMs ?? undefined, rainSensitive: task.requirements.rainSensitive,
          basis: plot.environmental ? 'ENVIRONMENT_REVIEWED' : 'OPERATOR_PROVISIONAL_WINDOW',
        },
      },
    };
    if (mission.owner === '장비') {
      const work = equipmentWork(next, mission);
      if (!work || work.basis !== 'PLAN_AREA_AND_SETUP') throw Error('신규 장비 작업의 면적·준비시간·처리능력을 확인하세요.');
      mission.equipmentWork = work;
    }
    next.missions.push(mission);
    created.add(mission.id);
  }
  linkNewWorkParts(next, plan, created);
  return next;
}
