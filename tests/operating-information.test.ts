import {describe,it,expect} from 'vitest';
import {cropCodes} from '../lib/crop-registry';
import {workloadCrops,workloadEquipment} from '../lib/crop-workload-catalog';
import {equipmentTypes,type LedgerMachine} from '../lib/equipment-register';
import {catalogForCrop,equipmentDescriptions,equipmentKindFor,equipmentOperations,informationCrop,machineKind,standardsForCrop,windowLabel} from '../lib/operating-information';
import {equipmentModelReferences} from '../lib/equipment-model-reference';
import type {SavedRegionalStandard} from '../lib/regional-crop-standard';

describe('shared crop / equipment information',()=>{
 it('covers the 30 executable crop identities and 11 inventory types without copying workload parameters',()=>{
  expect(workloadCrops).toHaveLength(30);expect(equipmentTypes).toHaveLength(11);
  for(const id of cropCodes){const info=informationCrop(id)!;expect(info.crop).toBe(workloadCrops.find(c=>c.id===id));expect(catalogForCrop(id),id).not.toBeNull();expect(info.equipment.length).toBeGreaterThan(0)}
  for(const [kind] of equipmentTypes){expect(equipmentDescriptions[kind]).toBeDefined();expect(equipmentOperations(kind).length).toBeGreaterThan(0)}
 });
 it('handles unknown IDs and missing yield without generating zero or substituting another crop',()=>{
  expect(informationCrop('unknown')).toBeNull();expect(informationCrop('__proto__')).toBeNull();
  expect(informationCrop('pepper')!.yieldReference!.yieldKgPer1000m2).toEqual({low:227,high:278});
  expect(informationCrop('apple')!.yieldReference).toBeNull();expect(informationCrop('apple')!.guideline).toBeNull();
 });
 it('preserves transport and sprayer classification and operator / worker units',()=>{
  expect(equipmentKindFor('GS')).toBe('SP');
  for(const eq of workloadEquipment){const kind=equipmentKindFor(eq.id);for(const row of equipmentOperations(kind))expect(row.method.capability).toBe(eq.id)}
  expect(equipmentOperations('TV').every(r=>r.method.transport>0)).toBe(true);
  const pepperHarvest=informationCrop('pepper')!.crop.operations.find(o=>o.code==='harvest')!;
  expect(pepperHarvest.methods[0]).toMatchObject({workers:3,minutesPer1000m2:360});
  expect(pepperHarvest.windows).toHaveLength(4);
 });
 it('retains next-year windows and exact seed-perilla / crop-practice identities',()=>{
  const barley=informationCrop('barley')!.crop.operations.find(o=>o.code==='harvest')!;
  expect(windowLabel(barley.windows[0],true)).toBe('다음 해 05-20 ~ 06-20');
  expect(windowLabel(barley.windows[0],false)).toBe('Year +1 05-20 ~ 06-20');
  expect(catalogForCrop('perilla')!.name).toBe('들깨(종실)');
 });
 it('does not let a center prefix imply a machine type or invent a model',()=>{
  const machine={id:'JSGNTR02',type:'트랙터'} as LedgerMachine;
  expect(machineKind(machine)).toBe('TR');
  expect(machineKind({...machine,id:'DRREGION01',type:'unknown'})).toBeNull();
  expect(machineKind({...machine,id:'anything',ledger:{kind:'PD'} as LedgerMachine['ledger']})).toBe('PD');
 });
 it('only associates exact regional profile identities, newest first',()=>{
  const saved=(id:string,catalogProfileId:string,updatedAt:string)=>({id,updatedAt,version:1,profile:{catalogProfileId}} as SavedRegionalStandard);
  const seed=catalogForCrop('perilla')!.id;
  const items=[saved('old',seed,'2026-09-01'),saved('leaf','nongsaro:210005:들깨(잎)','2026-10-01'),saved('new',seed,'2026-10-02')];
  expect(standardsForCrop('perilla',items).map(s=>s.id)).toEqual(['new','old']);
  expect(items.map(s=>s.id)).toEqual(['old','leaf','new']);
 });
 it('keeps manufacturer specs separate from scheduling rates, inventory, and safety thresholds',()=>{
  expect(equipmentModelReferences).toHaveLength(3);
  for(const m of equipmentModelReferences){expect(m.automaticallyApplied).toBe(false);expect(m.capacityHaHour).toBeNull();expect(new URL(m.sourceUrl).protocol).toBe('https:');expect(m.specs.length).toBeGreaterThan(2)}
  expect(equipmentModelReferences[0].specs.at(-1)!.value[0]).toContain('방제 허용 풍속 아님');
 });
 it('reading both directions leaves planning data unchanged',()=>{
  const before=JSON.stringify(workloadCrops);
  cropCodes.forEach(informationCrop);equipmentTypes.forEach(([kind])=>equipmentOperations(kind));
  expect(JSON.stringify(workloadCrops)).toBe(before);
 });
});
