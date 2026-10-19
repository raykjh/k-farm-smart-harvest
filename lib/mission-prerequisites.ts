import type {Mission,State} from './types';

type LinkedMission=Mission&{operationCode?:string;occurrence?:number;cultivationId?:string;predecessorMissionIds?:string[];equipmentSplit?:{groupId:string}};
// Missing routine care does not prove crop failure. Do not classify by label or
// waive planting, post-harvest processing, safety checks or unknown dependencies.
const routineCare=new Set(['consultation','establish','emerge','hill','drain','fertilize','fertilize-repeat','heading','stake','care','treat','spray','scout','nutrition','harvest-check']);
const needsReviewedInput=new Set(['treat','spray','fertilize','fertilize-repeat']);

export function missionPrerequisites(state:State,mission:Mission,asOf:string){
 const all=state.missions as LinkedMission[],target=mission as LinkedMission;
 const required=new Map<string,LinkedMission>(),advisory=new Map<string,LinkedMission>(),visiting=new Set<string>([target.id]);
 const parents=(m:LinkedMission)=>m.predecessorMissionIds??all.filter(p=>p.fieldId===m.fieldId&&(!m.cultivationId||p.cultivationId===m.cultivationId)&&Number(p.id.split('-').at(-1))<Number(m.id.split('-').at(-1))).sort((a,b)=>Number(a.id.split('-').at(-1))-Number(b.id.split('-').at(-1))).slice(-1).map(p=>p.id);
 const visit=(id:string,child:LinkedMission)=>{
  const prior=all.find(p=>p.id===id);
  if(!prior||prior.fieldId!==target.fieldId||visiting.has(id))throw Error('선행 작업 연결 오류');
  const sameSplit=!!prior.equipmentSplit&&prior.equipmentSplit.groupId===child.equipmentSplit?.groupId;
  const repeatHarvest=prior.operationCode==='harvest'&&child.operationCode==='harvest'&&Number(prior.occurrence)<Number(child.occurrence);
  const routine=routineCare.has(prior.operationCode??'')||repeatHarvest;
  const omitted=prior.status==='CANCELLED'&&prior.cancellation?.category==='UNNECESSARY';
  const elapsed=!!prior.scheduledDate&&prior.scheduledDate<asOf;
  // A review leading to pesticide/fertilizer application is still required.
  // Future tasks and split-package order retain their normal sequencing.
  const bypass=routine&&!sameSplit&&!needsReviewedInput.has(target.operationCode??'')&&(prior.status==='COMPLETED'||omitted||elapsed&&prior.status!=='CANCELLED');
  if(!bypass){required.set(id,prior);return;}
  if(prior.status!=='COMPLETED')advisory.set(id,prior);
  visiting.add(id);for(const parent of parents(prior))visit(parent,prior);visiting.delete(id);
 };
 for(const id of parents(target))visit(id,target);
 return {required:[...required.values()],advisory:[...advisory.values()]};
}
