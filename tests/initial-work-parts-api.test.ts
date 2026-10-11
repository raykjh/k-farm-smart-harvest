import {expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {catalogContext, catalogField, catalogState} from './catalog-fixtures';
import {box} from './split-work-area-fixture';
import {appendAssignments} from '../lib/plan-missions';
import {makeContract} from '../lib/annual-replanning';
import type {AnnualPlan} from '../lib/annual-plan';
import type {State} from '../lib/types';
import type {WorkMission} from '../lib/replan-work-split';
import * as engine from '../lib/scheduling-engine';
import {calculateCurrentSchedule} from './current-solver';
import {POST as register} from '../app/api/registrations/route';
import {GET as preview, POST as approve} from '../app/api/annual-dispatch/route';
import {POST as change} from '../app/api/cultivation-change/route';
import {GET as areas, POST as review} from '../app/api/equipment-missions/route';

it('initial registration produces reviewed per-part packets through the common persisted path; a later area change requires new geometry', async () => {
  if (!process.env.DATABASE_URL?.endsWith('/kfarm_test') || process.env.AI_MODE !== 'demo') throw Error('isolated model-free DB only');
  const base = await laborCapacityFixture();
  const prior = await db.workRecord.findMany();
  const session = await testSession();
  const solver = vi.spyOn(engine, 'solveSchedule').mockImplementation(calculateCurrentSchedule);
  const beforeCalls = await db.aiCall.count(), id = randomUUID(), contact = randomUUID();
  const req = (path: string, body?: unknown) => new NextRequest(`http://127.0.0.1:3100/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: session.headers, ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const checked = async (response: Promise<Response>) => {const r = await response, b = await r.json(); expect(r.status, JSON.stringify(b)).toBe(200); return b;};
  try {
    const field = catalogField('soybean', 2000), state = catalogState();
    state.crewCapacity = {operators: 1, workers: 4};
    state.machines = state.machines.map(m => ({...m, ownerCenterId: 'demo', ...(m.id.includes('SE') ? {capacityHaHour: 0.015} : {})}));
    state.operatorRoster = [{id: randomUUID(), name: '홍운영', active: true, kinds: ['TR', 'SE', 'GC', 'DR', 'SP', 'RD'], weekdays: [0, 1, 2, 3, 4, 5, 6], from: '2034-01-01', until: '2034-12-31', excludedDates: [], startMinute: 480, endMinute: 960, evidence: '격리 검증용 근무표'}];
    await db.center.update({where: {id: 'demo'}, data: {state: JSON.parse(JSON.stringify(state))}});
    await db.workRecord.deleteMany({where: {workspace: 'sandbox', kind: 'fields', id: 'current'}});
    const farmerField = {id: randomUUID(), pnu: field.pnu, address: field.address, area: '2000', crop: 'soybean', conditions: field.conditions, mode: 'delegated', tenure: 'owned', ownerName: '', ownerPhone: '', evidence: 'none', end: '', callAt: '', operator: '', callResult: 'pending', scope: '', verified: 'pending'};
    await checked(register(req('registrations', {
      requestId: randomUUID(), consultationId: contact, consultationVersion: 0, fieldVersion: 0, testDataOnly: true,
      consultation: {farmer: {name: '홍분할', birth: '1960-01-01', phone: '000-0000-0000', contact: 'sms'}, fields: [farmerField], consent: true, step: 3},
      cultivations: [{cultivation: {id, pnu: field.pnu, crop: 'soybean', start: '2034-01-01', end: '2034-12-31', source: 'REGISTERED'}, context: catalogContext()}],
    })));
    const plan = (await db.workRecord.findUniqueOrThrow({where: {workspace_kind_id: {workspace: 'sandbox', kind: 'cultivationPlan', id}}})).payload as unknown as AnnualPlan;
    const d = await checked(preview(req(`annual-dispatch?cultivationId=${id}`)));
    expect(d.feasibility[0].status).toBe('CAPACITY_FEASIBLE');
    const expected = appendAssignments(state, plan, d, {[contact]: '홍분할'});
    const decision = {cultivationId: id, token: d.token, demoAcknowledged: true};
    await checked(approve(req('annual-dispatch', decision)));
    expect((await checked(approve(req('annual-dispatch', decision)))).alreadyApplied).toBe(true);
    const saved = (await db.center.findUniqueOrThrow({where: {id: 'demo'}})).state as unknown as State;
    // Individual approval and delegated admission persist exactly the same jobs.
    expect(saved.missions).toEqual(JSON.parse(JSON.stringify(expected.missions)));
    const parts = (saved.missions as WorkMission[]).filter(m => m.equipmentSplit);
    expect(parts).toHaveLength(2);
    expect(parts.map(m => m.equipmentWork?.basis)).toEqual(['PLAN_AREA_AND_SETUP', 'PLAN_AREA_AND_SETUP']);
    const {contract} = makeContract(saved, {ids: parts.map(m => m.id), scope: 'PRESERVE', preferred: parts[0].scheduledDate}, {
      status: 'NOT_CONFIGURED', kind: 'short', sourceUrl: 'isolated-test', fetchedAt: '2033-12-31T00:00:00Z', points: [],
    }, '2033-12-31');
    const rescheduled = await calculateCurrentSchedule(contract);
    expect(rescheduled.status).toBe('FEASIBLE');
    if (rescheduled.status !== 'FEASIBLE') throw Error(rescheduled.reason);
    for (const m of parts) expect(rescheduled.assignments.find(a => a.id === m.id)).toBeDefined();
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const parent = {pnu: field.pnu, geometry: box(127, 35, 127.0002, 35.001), source: 'FIELD_SURVEY', reviewedOn: today, accessAndExclusionsReviewed: true, machineAccessConfirmed: true, note: '격리 검증용 가상 작업구역'};
    await checked(review(req('equipment-missions', {action: 'area', version: 0, area: parent})));
    let view = await checked(areas(req('equipment-missions')));
    const group = view.groups.find((g: any) => g.groupId === parts[0].equipmentSplit!.groupId);
    expect(group).toMatchObject({editable: true, ready: false});
    const draft = await checked(review(req('equipment-missions', {action: 'splitDraft', groupId: group.groupId, fingerprint: group.reviewFingerprint, axis: 'EW'})));
    await checked(review(req('equipment-missions', {
      action: 'splitArea', version: 0, fingerprint: group.reviewFingerprint,
      area: {groupId: group.groupId, source: 'OPERATOR_DRAWN', reviewedOn: today, note: '격리 검증용 회차별 확인', accessAndExclusionsReviewed: true, parts: draft.parts},
    })));
    view = await checked(areas(req('equipment-missions')));
    for (const m of parts) {
      const task = view.tasks.find((t: any) => t.id === m.id);
      expect(task.ready, JSON.stringify(task.blockers)).toBe(true);
      expect(task.data.workArea.geometry).not.toEqual(parent.geometry);
      const command = {missionId: m.id, fingerprint: task.fingerprint, requestId: randomUUID()};
      await checked(review(req('equipment-missions', {...command, action: 'prepare'})));
      const receipt = await checked(review(req('equipment-missions', {...command, requestId: randomUUID(), action: 'localReceipt'})));
      expect(receipt).toMatchObject({hardwareSent: false, executionAuthorized: false});
    }
    const areaBefore = await db.workRecord.findUniqueOrThrow({where: {workspace_kind_id: {workspace: 'sandbox', kind: 'splitWorkArea', id: group.groupId}}});
    const alteration = {id, crop: 'soybean', area: 4000, action: 'preview'};
    const changePreview = await checked(change(req('cultivation-change', alteration)));
    expect(changePreview.blockers).toEqual([]);
    await checked(change(req('cultivation-change', {...alteration, action: 'approve', token: changePreview.token, review: {cost: '검증 비용 검토', consent: '검증 동의'}})));
    const next = (await db.center.findUniqueOrThrow({where: {id: 'demo'}})).state as unknown as State;
    const newParts = (next.missions as WorkMission[]).filter(m => m.equipmentSplit);
    expect(newParts.length).toBeGreaterThan(parts.length);
    expect(newParts.every(m => m.equipmentSplit!.groupId !== group.groupId)).toBe(true);
    const demands = await db.workRecord.findMany({where: {workspace: 'sandbox', kind: 'laborDemand', id: {in: newParts.map(m => m.id)}}});
    expect(demands).toHaveLength(newParts.length);
    for (const m of newParts) expect(demands.find(r => r.id === m.id)?.payload).toMatchObject({missionId: m.id, date: m.scheduledDate, durationMinutes: m.duration * 15});
    expect(await db.workRecord.findUniqueOrThrow({where: {workspace_kind_id: {workspace: 'sandbox', kind: 'splitWorkArea', id: group.groupId}}})).toEqual(areaBefore);
    const changedView = await checked(areas(req('equipment-missions')));
    for (const m of newParts) {
      const task = changedView.tasks.find((t: any) => t.id === m.id);
      expect(task.blockers).toContain('SPLIT_WORK_AREA_REVIEW_REQUIRED');
      expect(task.data.workArea).toBeNull();
    }
    expect(await db.outbox.count({where: {farmerId: contact}})).toBe(2);
    expect(await db.aiCall.count()).toBe(beforeCalls);
  } finally {
    solver.mockRestore();
    const keys = new Set(prior.map(r => JSON.stringify([r.workspace, r.kind, r.id])));
    const added = (await db.workRecord.findMany({select: {workspace: true, kind: true, id: true}})).filter(r => !keys.has(JSON.stringify([r.workspace, r.kind, r.id])));
    if (added.length) await db.workRecord.deleteMany({where: {OR: added}});
    for (const record of prior.filter(r => r.workspace === 'sandbox' && r.kind === 'fields')) await db.workRecord.upsert({
      where: {workspace_kind_id: {workspace: record.workspace, kind: record.kind, id: record.id}},
      create: {...record, payload: record.payload as any}, update: {payload: record.payload as any, version: record.version, updatedAt: record.updatedAt},
    });
    await session.cleanup();
    await base.cleanup();
  }
}, 60000);
