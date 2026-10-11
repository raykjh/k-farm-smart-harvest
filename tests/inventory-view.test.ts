import {describe,it,expect} from 'vitest';
import {withRegisteredInventory} from '../lib/inventory-view';
import {initialState} from '../lib/seed';
import type {FieldEntry} from '../lib/field-record';
const entry:FieldEntry={pnu:'5274036023110930000',address:'계북면 검증 필지',area:1000,crop:'rice',mode:'joint',group:'',rights:'pending',consultationId:'10000000-0000-4000-8000-000000000001'};
describe('registered field read projection',()=>{
 it('shows unplanned registration without authorizing work or mutating stored state',()=>{
  const s=initialState(),before=structuredClone(s),next=withRegisteredInventory(s,[entry],{[entry.consultationId!]:'홍검증'});
  expect(s).toEqual(before);expect(next.missions).toEqual(before.missions);
  expect(next.fields.at(-1)).toMatchObject({id:entry.pnu,farmerId:entry.consultationId,name:'홍검증',confirmed:false,access:false,water:false,crop:'쌀'});
  expect(next.planVersion).toBe(s.planVersion);
 });
 it('does not duplicate or overwrite a field already linked to execution history',()=>{
  const s=withRegisteredInventory(initialState(),[entry]);s.fields.at(-1)!.crop='고추';
  const next=withRegisteredInventory(s,[{...entry,area:2000}]);
  expect(next.fields).toEqual(s.fields);expect(next.fields.filter(f=>f.id===entry.pnu)).toHaveLength(1);
 });
 it('does not invent farmer identity or crop when absent',()=>{
  const next=withRegisteredInventory(initialState(),[{...entry,crop:'',consultationId:undefined,area:null}]);
  expect(next.fields.at(-1)).toMatchObject({farmerId:'',crop:null,confirmed:false,area:0});
 });
});
