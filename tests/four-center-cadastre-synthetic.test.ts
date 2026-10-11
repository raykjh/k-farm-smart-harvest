import {describe,it,expect} from 'vitest';
import {cadastreSnapshotSchema,cadastralStudy,boundaryArea,parseCadastralPage,cadastreFingerprint} from '../lib/four-center-cadastre';
import {selectParticipatingOwners,distributeScenarioCrops,referenceCropWeights} from '../lib/capacity-study-input';
import {summarizeCapacity} from '../lib/capacity-workload';
import {syntheticCadastre as snapshot,syntheticRegions} from './synthetic-cadastre';

describe('cadastral protocol and capacity logic with invented test input',()=>{
 it('validates identities, closed boundaries, approximate area and region consistency',()=>{
  const s=cadastreSnapshotSchema.parse(snapshot);expect(s.parcels).toHaveLength(100);
  expect(new Set(s.parcels.map(p=>p.pnu)).size).toBe(100);
  for(const p of s.parcels)expect(boundaryArea(p.geometry)).toBe(p.areaM2);
  expect(cadastreFingerprint(s)).toBe(cadastreFingerprint(structuredClone(s)));
  expect(()=>cadastreSnapshotSchema.parse({...s,parcels:s.parcels.map((p,i)=>i===0?{...p,centerId:'janggye'}:p)})).toThrow();
 });
 it('selects 33 percent of owners, not of area, and computes reproducible resources',()=>{
  const input=distributeScenarioCrops(cadastralStudy(snapshot,2026),referenceCropWeights,'reference-weighted-v1');
  const selection=selectParticipatingOwners(input.population),summary=summarizeCapacity(input);
  expect(selection.populationCount).toBe(100);expect(selection.selectedCount).toBe(33);expect(selection.parcels).toHaveLength(33);
  expect(selection.byCenter.map(c=>c.owners)).toEqual([10,7,8,8]);
  expect(summary.tasks.length).toBeGreaterThan(100);expect(summary.blockers).toEqual([]);
  expect(summary.baseline.inputHash).toBe(summary.inputHash);
  expect(summarizeCapacity(structuredClone(input))).toEqual(summary);
 });
 it('rejects foreign regions and provider errors without filling missing parcels',()=>{
  const p=snapshot.parcels[0],r=syntheticRegions[0];
  const response=(pnu:string)=>({response:{status:'OK',result:{featureCollection:{features:[{properties:{pnu,jibun:'9000 답',addr:p.address},geometry:p.geometry}]}}}});
  expect(parseCadastralPage(response(p.pnu),r,'2026-10-11').parcels[0].pnu).toBe(p.pnu);
  expect(()=>parseCadastralPage(response('5274033599900000000'),r,'2026-10-11')).toThrow('지역');
  expect(()=>parseCadastralPage({response:{status:'ERROR'}},r,'2026-10-11')).toThrow();
  expect(parseCadastralPage({response:{status:'NOT_FOUND'}},r,'2026-10-11')).toEqual({parcels:[],exhausted:true});
 });
});
