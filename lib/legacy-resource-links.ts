import type {State,Mission} from './types';
import {centerDefinition} from './center-registry';
import {DEMO_BATCH,demoEquipment} from './registered-demo';
import {centerDemoBatch} from './center-demo-fixture';
import {demoEquipmentCrops} from './demo-equipment-crops';
import {demoOperationWindow} from './demo-operation-window';
import {isClosedTask} from './task-lifecycle';

export const RESOURCE_LINK_REPAIR='legacy-resource-links-v1';
/** Explicit, idempotent migration of known synthetic inputs. No generic runtime
 * inference of compatibility, new resources, work dates or completed results. */
export function repairLegacyResourceLinks(raw:State,centerId:string,asOf:string,originals:ReadonlyMap<string,Mission>){
 const state=structuredClone(raw),machines:string[]=[],windows:string[]=[];
 const legacy=centerId==='demo'&&raw.ruleVersion===DEMO_BATCH;
 const fixture=['janggye','cheoncheon','gyenam'].includes(centerId)&&raw.demoResourceBatchId===centerDemoBatch;
 if(!legacy&&!fixture)return {state,machines,windows};
 const prefix=centerDefinition(centerId).prefix;
 for(const m of state.machines){
  if(m.ownerCenterId&&m.ownerCenterId!==centerId||m.compatibleCrops!==undefined)continue;
  const kind=demoEquipment.find(([code])=>[`${prefix}${code}01`,`${prefix}${code}02`].includes(m.id))?.[0];
  if(!kind)continue;
  // The fixed batch establishes fictional capabilities; explicit newer values
  // (including an empty list) are deliberately not overwritten.
  m.compatibleCrops=[...demoEquipmentCrops[kind]];machines.push(m.id);
 }
 if(legacy)for(const m of state.missions){
  if(m.planningWindow||isClosedTask(m.status)||!m.scheduledDate||m.scheduledDate<asOf)continue;
  const original=originals.get(m.id),field=state.fields.find(f=>f.id===m.fieldId);
  if(!original||field?.source!=='DEMO_ASSUMPTION'||original.fieldId!==m.fieldId||original.label!==m.label||original.crop!==m.crop||original.resourceId!==m.resourceId||original.duration!==m.duration)continue;
  const window=demoOperationWindow(m,original);if(!window)continue;
  m.planningWindow=window;windows.push(m.id);
 }
 return {state,machines,windows};
}
