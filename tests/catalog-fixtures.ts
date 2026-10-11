import {emptyConditions,type FieldConditions} from '../lib/field-conditions';
import {isOrchardCrop,cropCodes,type SupportedCropCode} from '../lib/crop-registry';
import {WORKLOAD_CATALOG_VERSION,workloadEquipment} from '../lib/crop-workload-catalog';
import {planningContext} from '../lib/planning-context';
import type {FieldEntry} from '../lib/field-record';
import type {Cultivation} from '../lib/cultivation';
import {registeredDemo} from './registered-demo-fixture';
import type {State} from '../lib/types';

// Synthetic field/resource assumptions, used only by isolated tests.
export const catalogContext=(year=2034)=>planningContext.parse({region:'계북면',catalog:{version:WORKLOAD_CATALOG_VERSION,year,dataOrigin:'DEMO',sourceBatchId:'isolated-crop30-test'}});
export function catalogField(crop:SupportedCropCode,area=1000):FieldEntry{
 const orchard=isOrchardCrop(crop);
 return {pnu:'5274036023900010001',address:'격리 테스트 필지',area,crop,mode:'full',group:'',rights:'pending',consultationId:'10000000-0000-4000-8000-000000000001',conditions:{...emptyConditions(),region:'계북면',landUse:crop==='rice'?'paddy':orchard?'orchard':'upland',water:'yes',drainage:'good',machineAccess:'yes',laborAvailable:'yes',climate:{rice:'unsuitable',potato:'unsuitable',pepper:'unsuitable',[crop]:'suitable'},...(orchard?{existingBearingOrchard:true,existingOrchardCrop:crop as FieldConditions['existingOrchardCrop']}:{}),checkedOn:'2026-09-01',evidence:'격리 검증용 적합성 가정'}};
}
export const catalogCycle=(crop:SupportedCropCode):Cultivation=>({id:'20000000-0000-4000-8000-000000000001',pnu:catalogField(crop).pnu,crop,start:'2034-01-01',end:'2035-12-31',source:'REGISTERED'});
export function catalogState():State{
 return {...registeredDemo().state,fields:[],missions:[],events:[],revisions:[],staffCount:20,transportCount:5,centerSharing:undefined,
  machines:workloadEquipment.map(e=>({id:'TEST'+(e.id==='GS'?'SP':e.id)+'01',name:e.name,type:e.name,status:'AVAILABLE',safetyLock:false,capacityHaHour:2,compatibleCrops:[...cropCodes]}))};
}
