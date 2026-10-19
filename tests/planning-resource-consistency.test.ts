import {it, expect, vi} from 'vitest';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {makeContract, verifyAssignments, dateSlot, calculateAnnualReplan} from '../lib/annual-replanning';
import {relatedReplanIds} from '../lib/replan-scope';
import {emptyCenter} from '../lib/center-registry';
import type {AnnualPlan} from '../lib/annual-plan';
import type {Mission} from '../lib/types';

const date = '2027-05-02';
const weather = {status:'NOT_CONFIGURED', kind:'short', sourceUrl:'test', points:[]} as any;
function fixture(conflict: 'field'|'machine'|'person'|'staff'|'transport'|'none') {
 const state = emptyCenter('demo');
 state.staffCount = conflict === 'staff' ? 1 : 4;
 state.transportCount = conflict === 'transport' ? 1 : 4;
 state.fields = ['new','existing'].map(id => ({id, farmerId:conflict === 'person' ? 'same-farmer' : id,
  name:id, address:id, area:1000, crop:'쌀', mode:'공동참여형', access:true, water:true, confirmed:true, cluster:'test', source:'REGISTERED'}));
 state.machines = ['TR01','TR02'].map(id => ({id, ownerCenterId:'demo', name:id, type:'트랙터', status:'AVAILABLE', safetyLock:false, capacityHaHour:0.0125}));
 const selected = {id:'selected', fieldId:'new', label:'경운', crop:'쌀', owner:conflict === 'person' ? '농부' : '장비',
  status:'PLANNED', resourceId:conflict === 'person' ? null : 'TR01', scheduledDate:'2027-05-03', month:5,
  start:0, duration:32, deadline:32, priority:1, batchKey:'test', staff:conflict === 'person' ? 0 : 1, transport:conflict === 'person' ? 0 : 1,
  operationKey:'new-op', predecessorMissionIds:[], planningWindow:{from:date, to:date, duration:32, rainSensitive:false, windLimitMs:10, basis:'OPERATOR_PROVISIONAL_WINDOW'}} as Mission;
 const existing = {...selected, id:'existing', fieldId:conflict === 'field' ? 'new' : 'existing', scheduledDate:date,
  resourceId:conflict === 'machine' ? 'TR01' : conflict === 'person' ? null : 'TR02', operationKey:'existing-op'};
 state.missions = [existing];
 const plan = {year:2027, plots:[{pnu:'new', crop:'rice', area:1000, mode:'joint', tasks:[{id:'selected', operationKey:'new-op',
  predecessorKeys:[], kind:'PROCESS', window:{from:date,to:date}, requirements:{owner:selected.owner, machineCode:conflict === 'person' ? null : 'TR',
   staff:selected.staff, transport:selected.transport, setupMinutes:0, laborMinutesPer1000m2:480}}]}]} as unknown as AnnualPlan;
 // Only the requested resource is a candidate for the initial placement.
 const initialState = {...state, machines:state.machines.filter(m => m.id === 'TR01')};
 const contract = makeContract({...state, missions:[existing,selected]}, {ids:['selected'], scope:'PRESERVE', preferred:date}, weather, '2027-05-01').contract;
 const assignments = contract.tasks.map(t => ({id:t.id,start:dateSlot(date),resource:t.resource}));
 return {state, selected, plan, initialState, contract, assignments};
}

for (const conflict of ['field','machine','person','staff','transport','none'] as const) {
 it(`initial placement and replan verification agree about ${conflict} conflicts`, async () => {
  const {plan,initialState,contract,assignments} = fixture(conflict);
  const before = JSON.stringify(initialState);
  // A field owner is no longer a dedicated worker: ordinary labor capacity governs both paths.
  const feasible=conflict==='none'||conflict==='person';
  expect((await previewAnnualDispatch(plan,initialState,'2027-05-01')).assignments).toHaveLength(feasible ? 1 : 0);
  if (feasible) expect(() => verifyAssignments(contract,assignments,'GAPS_ONLY')).not.toThrow();
  else expect(() => verifyAssignments(contract,assignments,'GAPS_ONLY')).toThrow('충돌');
  expect(JSON.stringify(initialState)).toBe(before);
 });
}

it('includes same-field jobs in related expansion even with different machines and ample capacity', () => {
 const {state,selected} = fixture('field');
 state.missions.push(selected);
 expect([...relatedReplanIds(state,['selected'],'2027-05-01')]).toContain('existing');
 const contract = makeContract(state,{ids:['selected'],scope:'EXPAND'},weather,'2027-05-01').contract;
 expect(contract.tasks.find(t=>t.id==='existing')).toMatchObject({field:'new',movable:true});
});

it('foreign equipment occupancy blocks that equipment without consuming local fields or crew', async () => {
 const {plan,initialState} = fixture('none');
 initialState.staffCount=1;initialState.transportCount=1;
 initialState.missions=['DR01','DR02'].map(resourceId=>({...initialState.missions[0],id:resourceId,
  fieldId:'external:janggye',resourceId,resourceOccupancyOnly:true,staff:0,transport:0}));
 expect((await previewAnnualDispatch(plan,initialState,'2027-05-01')).assignments).toHaveLength(1);
 initialState.missions[0].resourceId='TR01';
 expect((await previewAnnualDispatch(plan,initialState,'2027-05-01')).assignments).toHaveLength(0);
 expect(()=>makeContract(initialState,{ids:['DR01'],scope:'EXPAND'},weather,'2027-05-01')).toThrow('잠금');
});

it('real solver protects the same field in gap mode and moves only its conflicting work in expansion', async () => {
 const {state,selected} = fixture('field');
 Object.assign(state.missions[0],{planningWindow:{from:date,to:'2027-05-03',duration:32,rainSensitive:false,windLimitMs:10,basis:'OPERATOR_PROVISIONAL_WINDOW'}});
 state.missions.push(selected);
 const before=JSON.stringify(state),input={ids:['selected'],preferred:date};
 expect((await calculateAnnualReplan(state,{...input,scope:'PRESERVE'},weather,'2027-05-01')).status).toBe('NO_FEASIBLE_PLAN');
 const result=await calculateAnnualReplan(state,{...input,scope:'EXPAND'},weather,'2027-05-01');
 expect(result.status).toBe('FEASIBLE');
 expect(result.assignments).toEqual(expect.arrayContaining([{id:'selected',start:dateSlot(date),resource:'TR01'},
  {id:'existing',start:dateSlot('2027-05-03'),resource:'TR02'}]));
 expect(JSON.stringify(state)).toBe(before);
});

it('rejects a stale solver contract rather than saving a plan without field constraints', async () => {
 const {state,selected}=fixture('none');state.missions.push(selected);
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({status:'FEASIBLE',contractVersion:'annual-replan-v2'})));
 try {await expect(calculateAnnualReplan(state,{ids:['selected']},weather,'2027-05-01')).rejects.toThrow('계산 서버를 재시작');}
 finally {fetch.mockRestore();}
});
