import type {AnnualPlan} from './annual-plan';
import type {Field,State} from './types';
import type {FieldEntry} from './field-record';
import {cropNames} from './crop-registry';
export function planFieldsCurrent(plan:AnnualPlan,version:number,fields:FieldEntry[]){
 if(plan.fieldVersion===version)return true;
 if(!plan.cultivation)return false;
 return plan.plots.every(p=>{const f=fields.find(f=>f.pnu===p.pnu);return !!f&&f.area===p.area&&f.address===p.address&&f.mode===p.mode&&f.group===p.group&&(f.consultationId??null)===p.consultationId&&JSON.stringify(f.conditions??null)===JSON.stringify(p.conditions??null);});
}

/** Project canonical saved fields into the operational read model.
 * Preserve existing contact and execution records; never infer consent/contact.
 */
export function connectPlanningFields(plan:AnnualPlan,state:State):State {
 const result=structuredClone(state);
 const crops=cropNames;
 for(const p of plan.plots){
  const prior=result.fields.find(f=>f.id===p.pnu);
  const updated={address:p.address,area:p.area,crop:crops[p.crop as keyof typeof crops],mode:(p.mode==='joint'?'공동참여형':'완전 위탁형') as Field['mode'],cluster:p.group};
  if(prior?.serviceStatus==='WITHDRAWN')throw Error('위탁 종료된 농지는 새 접수 확인이 필요합니다.');
  if(prior){const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);Object.assign(prior,plan.cultivation&&(today<plan.cultivation.start||today>plan.cultivation.end)?{address:p.address,area:p.area}:updated);}
  else result.fields.push({id:p.pnu,farmerId:'',name:p.address,...updated,access:false,water:false,confirmed:false,source:'REGISTERED'});
 }
 return result;
}
