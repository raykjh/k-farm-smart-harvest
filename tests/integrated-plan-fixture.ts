import {demoResourceState} from '../lib/registered-demo';
import {cropGuidelines} from '../lib/crop-guidelines';
import {emptyConditions} from '../lib/field-conditions';
import {emptyCoordinationPolicy} from '../lib/production-coordination';
import type {ProductionSource} from '../lib/production-service';
import type {JointCompletion} from '../lib/integrated-plan-adviser';
export function jointSource(id='demo',count=2):ProductionSource{
 const fields=Array.from({length:count},(_,i)=>({pnu:'5274036023'+String(910000000+i).padStart(9,'0'),address:`PRIVATE ADDRESS ${i}`,area:1000,crop:'' as const,mode:'full' as const,group:'',rights:'pending' as const,consultationId:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,conditions:{...emptyConditions(),region:'계북면',landUse:'upland' as const,water:'yes' as const,drainage:'good' as const,machineAccess:'yes' as const,laborAvailable:'yes' as const,climate:{rice:'unsuitable' as const,potato:'suitable' as const,pepper:'suitable' as const},evidence:'PRIVATE REVIEW',checkedOn:'2026-01-01'}}));
 const today='2026-10-16',operations=Object.fromEntries((['potato','pepper'] as const).map(crop=>[crop,Object.fromEntries(cropGuidelines[crop].steps.filter(s=>['PROCESS','REPEAT'].includes(s.kind)).map((s,i)=>[s.code,{from:`2027-${String(i+2).padStart(2,'0')}-01`,to:`2027-${String(i+2).padStart(2,'0')}-20`,laborMinutesPer1000m2:crop==='potato'?30:120}]))]));
 return {scopeId:id,state:{...demoResourceState(),staffCount:4,centerSharing:{centerId:id,neighborCenterIds:[],loans:[]},machines:demoResourceState().machines.map(m=>({...m,id:id==='demo'?m.id:id+m.id,ownerCenterId:id}))},fields,version:1,cycles:[],participations:fields.map(f=>({pnu:f.pnu,consultationId:f.consultationId,receivedAt:'2026-10-01T00:00:00Z',status:'ACTIVE',term:{from:'2026-01-01',until:null,continuousConsent:true},changedAt:'2026-10-01T00:00:00Z',reason:'TEST'})),criteria:{profiles:[{id:'checked-test-season',name:'Synthetic review only',context:{region:'계북면',operations}}]},contacts:fields.map(f=>({id:f.consultationId,payload:{farmer:{name:'PRIVATE NAME',phone:'PRIVATE PHONE'},consent:true,fields:[{pnu:f.pnu,mode:'delegated',tenure:'owned'}]}})),shared:[],history:[],today,coordination:{centerId:id,today,origin:'REGISTERED',policy:emptyCoordinationPolicy(),policyVersion:0,contributions:[],totals:[],unquantified:0,coverage:'PARTICIPATING_CULTIVATIONS_ONLY'},operationKinds:[]};
}
export const fakeJointCompletion:JointCompletion=async body=>{
 const messages=body.messages as any[],input=JSON.parse(messages[1].content),last=messages.at(-1);
 const result=last.role==='tool'?JSON.parse(last.content):null;
 const args=result?{evaluationId:result.id,assessments:Object.fromEntries(result.evaluatedIds.map((id:string)=>[id,id===result.id?'missingTasks':'personHours']))}:{choices:Object.fromEntries(input.fields.map((f:any,i:number)=>[f.id,(f.options.find((o:any)=>o.crop===(i%2?'pepper':'potato'))??f.options[0]).id])),staffing:'PEAK_ONLY'};
 return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'test-call',type:'function',function:{name:result?'select_plan':'evaluate_plan',arguments:JSON.stringify(args)}}]}}]};
};
