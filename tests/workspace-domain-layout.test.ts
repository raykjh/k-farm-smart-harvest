import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import ReferencesPage from '../app/references/page';
import CapacityPage from '../app/capacity/page';
const source=(p:string)=>readFileSync(p,'utf8');

it('keeps operational domains and reference libraries without a duplicate production menu',()=>{
 const nav=source('components/workspace-sidebar.tsx'),dashboard=source('components/dashboard.tsx');
 expect(nav).not.toContain("['생산관리'");
 for(const name of ['농지·농가','인력관리','장비','crop-info','equipment-info'])expect(nav).toContain(name);
 expect(dashboard).not.toContain('fieldTab');
 expect(dashboard).not.toContain("t('생산현황','Production overview')");
 expect(source('components/operations-overview.tsx')).toContain('<ManagedFields');
 const managed=source('components/managed-fields.tsx');
 expect(managed).toContain('AI 계획·일괄 확정');
 expect(managed).toContain('<FieldManagement');
 expect(managed).toContain('<ContinuousProductionPanel');
 expect(dashboard).toContain("equipmentTab==='reservations'&&<Reservations embedded");
 expect(dashboard).not.toContain('<CenterSettings section="labor"');
 expect(dashboard).not.toContain('<CenterSettings section="equipment"');
 expect(dashboard).toContain('<OperatingRecords/>');
 expect(source('components/equipment-register.tsx')).toContain('<EquipmentWorkLog');
 expect(source('components/equipment-register.tsx')).not.toContain("t('운용담당자'");
 expect(source('components/labor-operations-panel.tsx')).not.toContain("t('보수·근무 조건'");
 expect(source('components/labor-operations-panel.tsx')).not.toContain('<LaborCommonPolicy');
 for(const section of ['regular-workers','casual-workers'])expect(source('components/labor-operations-panel.tsx')).toContain(section);
 expect(source('components/field-work-history.tsx')).toContain('<OperatingRecords fieldId={fieldId}');
});
it('consolidates crop records, common standards and workload planning in the crop library',()=>{
 const page=source('components/crop-information.tsx');
 for(const text of ['재배기록','작물 기준자료','30작물 자원계획','<CultivationRecords','<CropReferencePanel embedded','<CapacityStudyPanel','<ProductionCriteriaEditor'])expect(page).toContain(text);
 const records=source('components/cultivation-records.tsx');
 expect(records).toContain('c.closedAt');expect(records).toContain('tab=fields&field=');
 expect(records).not.toContain("method:'POST'");
 expect(source('components/continuous-production-panel.tsx')).not.toContain('<ProductionCoordinationPanel');
});
it('keeps equipment references independent of individual inventory and field crop edits compact',()=>{
 const equipment=source('components/equipment-information.tsx');
 expect(equipment).not.toContain('/api/equipment-information');expect(equipment).not.toContain("tab==='inventory'");
 expect(equipment).toContain('equipmentOperations(kind)');expect(equipment).toContain('equipmentModelReferences');
 const fields=source('components/field-management.tsx');
 for(const tab of ['소유주','농지 정보','작물·생산','작업 이력'])expect(fields).toContain(tab);
 expect(fields).toContain('ContinuousProductionPanel fieldId={field.id}');
 expect(fields).toContain('<FieldConditionsInput');
 expect(source('components/field-crop-manager.tsx')).not.toContain('RegionalContextEditor');
});
it.each([[ReferencesPage,'/crop-info?tab=references'],[CapacityPage,'/crop-info?tab=capacity']] as const)('retains the former reference URL via its new location', (page,location)=>{
 let error:unknown;try{page()}catch(e){error=e}
 expect((error as {digest:string}).digest).toContain(location);
});
