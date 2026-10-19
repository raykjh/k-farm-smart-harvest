import type {FieldEntry} from './field-record';
import type {Field,State} from './types';
import {cropNames} from './crop-registry';
/** Read-only inventory projection: registration is not execution approval.
 * Existing cultivation/execution fields remain intact, including past crop identity.
 */
export function withRegisteredInventory(state:State,entries:FieldEntry[],names:Record<string,string>={}):State{
 const fields=[...state.fields];
 for(const entry of entries){
  const index=fields.findIndex(f=>f.id===entry.pnu);
  if(index>=0){if(entry.conditions)fields[index]={...fields[index],machineAccess:entry.conditions.machineAccess};continue;}
  fields.push({id:entry.pnu,address:entry.address,area:entry.area??0,
   crop:entry.crop?cropNames[entry.crop]:null,
   farmerId:entry.consultationId??'',name:names[entry.consultationId??'']??entry.address,
   mode:entry.mode==='joint'?'공동참여형':'완전 위탁형',cluster:entry.group,
   machineAccess:entry.conditions?.machineAccess??'unknown',access:false,water:false,confirmed:false,source:'REGISTERED'} satisfies Field);
 }
 return {...state,fields};
}
