import {describe,it,expect} from 'vitest';
import {initialState,annualMissions} from '../lib/seed';
import {demoSeason2026} from '../lib/demo-season';
describe('2026 demo season',()=>{
 it('preserves explicitly cancelled tasks',()=>{
  const state=initialState();state.fields.forEach(f=>f.crop??='쌀');state.missions=annualMissions(state);state.missions[0].status='CANCELLED';state.missions[0].scheduledDate='2026-07-01';
  expect(demoSeason2026(state).missions[0]).toEqual(state.missions[0]);
 });
 it('keeps history before September and future work in the same year',()=>{
  const state=initialState();state.fields.forEach(f=>f.crop??='쌀');
  state.missions=annualMissions(state);
  const dated=state.missions.filter(m=>m.scheduledDate);
  expect(dated.every(m=>m.scheduledDate!.startsWith('2026-'))).toBe(true);
  expect(dated.some(m=>m.scheduledDate!.startsWith('2026-01'))).toBe(true);
  expect(dated.filter(m=>m.scheduledDate!<'2026-09-09').every(m=>m.status==='COMPLETED')).toBe(true);
  expect(dated.filter(m=>m.scheduledDate!>='2026-09-09').every(m=>m.status==='PLANNED')).toBe(true);
  expect(state.missions.filter(m=>m.resourceId).every(m=>m.month===9)).toBe(true);
  expect(demoSeason2026(state)).toEqual(state);
 });
});
