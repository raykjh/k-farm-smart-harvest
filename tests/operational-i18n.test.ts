import {describe,it,expect} from 'vitest';
import {operationalText} from '../lib/operational-i18n';
import {cropGuidelines} from '../lib/crop-guidelines';
import {workloadCrops} from '../lib/crop-workload-catalog';
import {publicYieldCriteria} from '../lib/public-crop-criteria';
describe('English operational presentation',()=>{
 it('translates all legacy guideline steps and timing without changing source records',()=>{
  const before=JSON.stringify(cropGuidelines);
  for(const crop of Object.values(cropGuidelines))for(const step of crop.steps){
   expect(operationalText(step.name,'en')).not.toMatch(/[가-힣]/);
   expect(operationalText(step.timing,'en')).not.toMatch(/[가-힣]/);
   expect(operationalText(step.name,'ko')).toBe(step.name);
  }
  expect(JSON.stringify(cropGuidelines)).toBe(before);
 });
 it('preserves proper names and unknown authored notes',()=>{
  for(const value of ['전북특별자치도 장수군 계북면 농소리 1093','홍길동','벼 콤바인 1호','계북면 농업지원센터','담당자가 직접 작성한 현장 기록','JB23CB01'])expect(operationalText(value,'en')).toBe(value);
 });
 it('localizes repeated work and handles absent values',()=>{
  expect(operationalText('완숙 고추 반복 수확 · 2회','en')).toBe('Repeated ripe pepper harvest · round 2');
  expect(operationalText(undefined,'en')).toBe('');
 });
 it('covers the active workload catalog operation names',()=>{
  for(const crop of workloadCrops)for(const op of crop.operations)expect(operationalText(op.name,'en'),op.name).not.toMatch(/[가-힣]/);
 });
 it('localizes statistical page references without altering their source URLs',()=>{
  const before=JSON.stringify(publicYieldCriteria);
  for(const reference of publicYieldCriteria)expect(operationalText(reference.locator,'en'),reference.locator).not.toMatch(/[가-힣]/);
  expect(JSON.stringify(publicYieldCriteria)).toBe(before);
 });
});
