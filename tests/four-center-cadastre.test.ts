import {describe,it,expect} from 'vitest';
import {readProviderArtifact} from '../lib/provider-artifacts';
import type {CadastreSnapshot} from '../lib/four-center-cadastre';
import {cadastreSnapshotSchema,cadastralStudy,boundaryArea,parseCadastralPage,cadastreFingerprint} from '../lib/four-center-cadastre';
import {capacityStudySchema,selectParticipatingOwners,baselineResourcesSchema,distributeScenarioCrops,referenceCropWeights} from '../lib/capacity-study-input';
import {summarizeCapacity} from '../lib/capacity-workload';

// Optional integration evidence for independently obtained provider files. Core
// parser/workflow tests use explicit synthetic inputs and run without these files.
const snapshot=readProviderArtifact('cadastre') as CadastreSnapshot|null;
const prepared=readProviderArtifact('capacityStudy') as {input:unknown;resources:unknown;provenance:{snapshotHash:string}}|null;
describe.skipIf(!snapshot||!prepared)('optional provider snapshot with separate scenario owners',()=>{
 it('retains observed PNU, township, closed boundary and source for 100 public parcels',()=>{
  const s=cadastreSnapshotSchema.parse(snapshot);
  expect(s.parcels).toHaveLength(100);expect(new Set(s.parcels.map(p=>p.pnu)).size).toBe(100);
  expect(s.regions.map(r=>r.code)).toEqual(['52740360','52740335','52740340','52740350']);
  for(const p of s.parcels)expect(boundaryArea(p.geometry)).toBe(p.areaM2);
  expect(cadastreFingerprint(s)).toBe(prepared!.provenance.snapshotHash);
  expect(()=>cadastreSnapshotSchema.parse({...s,parcels:s.parcels.map((p,i)=>i===0?{...p,centerId:'janggye'}:p)})).toThrow();
 });
 it('builds 33 of 100 fictitious owners, not 33 percent of area or actual owners',()=>{
  const input=capacityStudySchema.parse(prepared!.input),selection=selectParticipatingOwners(input.population);
  expect(selection.populationCount).toBe(100);expect(selection.selectedCount).toBe(33);
  expect(selection.parcels).toHaveLength(33);expect(selection.byCenter.map(c=>c.owners)).toEqual([10,7,8,8]);
  const baseline=baselineResourcesSchema.parse(prepared!.resources),summary=summarizeCapacity(input);
  expect(summary.tasks).toHaveLength(299);
  expect(summary.inputHash).toBe(baseline.inputHash);
  expect(summary.blockers).toEqual([]);
  expect(distributeScenarioCrops(cadastralStudy(snapshot,2026),referenceCropWeights,'reference-weighted-v1')).toEqual(input);
  expect(input.population.description).toContain('실제 전체 농지·소유자 모집단');
 });
 it('fails on contradictory geography and never substitutes a synthetic parcel',()=>{
  const p=snapshot!.parcels[0],r={centerId:'demo' as const,code:p.townshipCode,name:'계북면'};
  const response=(pnu:string)=>({response:{status:'OK',result:{featureCollection:{features:[{properties:{pnu,jibun:'1 답',addr:p.address},geometry:p.geometry}]}}}});
  expect(parseCadastralPage(response(p.pnu),r,'2026-10-03').parcels[0].pnu).toBe(p.pnu);
  expect(()=>parseCadastralPage(response('5274033510100010000'),r,'2026-10-03')).toThrow('지역');
  expect(()=>parseCadastralPage({response:{status:'ERROR'}},r,'2026-10-03')).toThrow();
  expect(parseCadastralPage({response:{status:'NOT_FOUND'}},r,'2026-10-03')).toEqual({parcels:[],exhausted:true});
 });
});
