import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {buildAnnualPlan} from './annual-plan';
import {cropGuidelines,type CropCode} from './crop-guidelines';
import {previewAnnualDispatch} from './annual-dispatch';
import {appendAssignments} from './delegated-planning';
import {demoResourceState} from './registered-demo';
import {emptyLaborOps,availableFor,notice,respond,type LaborJob,type LaborOps} from './labor-operations';
import {missionReservation} from './plan-reservation-sync';
import {validateReservations,type SharedReservation} from './shared-reservations';
import type {FieldEntry} from './field-record';
import type {State} from './types';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x=>Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x);
export const experienceAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('register'),name:z.string().trim().min(1).max(40),address:z.string().trim().min(1).max(160),area:z.number().min(100).max(100000),crop:z.enum(['rice','potato','pepper'])}).strict(),
 z.object({action:z.literal('plan'),start:date,machines:z.number().int().min(0).max(2),workers:z.number().int().min(0).max(2)}).strict(),
 z.object({action:z.literal('approve')}).strict(),z.object({action:z.literal('cancel'),reason:z.string().trim().min(1).max(300)}).strict(),
 z.object({action:z.literal('respond'),jobId:z.string(),workerId:z.string(),response:z.enum(['APP','PHONE','DECLINED'])}).strict(),
 z.object({action:z.literal('reset')}).strict(),
]);
export type Experience={phase:'EMPTY'|'REGISTERED'|'PLANNED'|'APPROVED'|'CANCELLED'|'REPLANNED';fields:FieldEntry[];names:Record<string,string>;state:State;draft:any;reservations:SharedReservation[];labor:LaborOps;history:{at:string;event:string;detail:any}[]};
export function emptyExperience():Experience{
 const state=demoResourceState();
 const labor=emptyLaborOps();
 labor.people=Array.from({length:2},(_,i)=>({id:randomUUID(),name:['홍일손','홍두손'][i],birth:'1960-01-01',phone:'000-0000-0000',address:'계북면 가상 거주지',registeredFarmer:false,usesApp:i===0,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['*'],active:true}));
 return {phase:'EMPTY',fields:[],names:{},state,draft:null,reservations:[],labor,history:[]};
}
export async function transitionExperience(original:Experience,input:unknown):Promise<Experience>{
 const b=experienceAction.parse(input);if(b.action==='reset')return emptyExperience();
 const s=structuredClone(original),now=new Date().toISOString();
 if(b.action==='register'){
  if(!['EMPTY','REGISTERED'].includes(s.phase))throw Error('등록은 계획 전 단계에서 가능합니다. 초기화 후 새 흐름을 시작하세요.');
  if(s.fields.length>=10)throw Error('체험은 최대 10농지입니다.');
  const pnu='5274036023'+String(s.fields.length+1).padStart(9,'0'),contact=randomUUID();
  s.fields.push({pnu,address:b.address,area:b.area,crop:b.crop,mode:'full',group:'',rights:'pending',consultationId:contact});s.names[contact]=b.name;s.phase='REGISTERED';
 }else if(b.action==='plan'){
  if(!['REGISTERED','PLANNED','CANCELLED','REPLANNED'].includes(s.phase)||!s.fields.length)throw Error('등록 또는 취소 후 계획할 수 있습니다.');
  const year=Number(b.start.slice(0,4));if(year<2026||year>2100)throw Error('연도를 확인하세요.');
  const shift=(n:number)=>new Date(Date.parse(b.start)+n*86400000).toISOString().slice(0,10);
  if(!shift(100).startsWith(String(year)))throw Error('체험 계획은 같은 연도 안에서 100일 여유가 필요합니다.');
  const operations=Object.fromEntries((['rice','potato','pepper'] as CropCode[]).map(c=>[c,Object.fromEntries(cropGuidelines[c].steps.map((step,i)=>[step.code,{from:shift(i*8),to:shift(i*8+7),laborMinutesPer1000m2:60,staff:1}]))]));
  const state=demoResourceState();
  state.machines=state.machines.filter((m,i,a)=>a.slice(0,i).filter(x=>x.type===m.type).length<b.machines).map(m=>({...m,status:'AVAILABLE',safetyLock:false,ownerCenterId:undefined}));state.staffCount=b.workers;state.transportCount=2;
  const plan=buildAnnualPlan(s.fields,year,1,{region:'계북면',operations});
  const dispatch=(await previewAnnualDispatch(plan,state,shift(-1)));s.state=state;s.draft={plan,dispatch,start:b.start};s.phase=s.phase==='CANCELLED'||s.phase==='REPLANNED'?'REPLANNED':'PLANNED';
 }else if(b.action==='approve'){
  if(!['PLANNED','REPLANNED'].includes(s.phase)||!s.draft)throw Error('계산한 계획이 필요합니다.');
  const {plan,dispatch}=s.draft;if(!dispatch.assignments.length||dispatch.feasibility.some((f:any)=>f.status!=='CAPACITY_FEASIBLE'))throw Error('필수 작업 자원이 부족합니다. 장비·인력을 보강하고 재계산하세요.');
  s.state=appendAssignments(s.state,plan,dispatch,s.names);
  s.reservations=s.state.missions.flatMap(m=>{const r=missionReservation('experience',m);return r?[r]:[]});validateReservations(s.reservations,[]);
  for(const a of dispatch.assignments.filter((a:any)=>!a.machineId&&a.owner==='센터 인력')){
   const task=s.state.missions.find(m=>m.id===a.taskId)!;
   const job:LaborJob={id:randomUUID(),missionId:task.id,task:task.label,address:s.fields.find(f=>f.pnu===task.fieldId)!.address,date:a.date,startMinute:a.startMinute,durationMinutes:a.durationMinutes,count:a.staff,workCode:'general',sourceHash:randomUUID(),pay:'임시 체험 조건',status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[]};
   job.invited=s.labor.people.filter(p=>availableFor(p,job)).map(p=>p.id);s.labor.jobs.push(job);
   for(const id of job.invited)notice(s.labor,job,id,s.phase==='REPLANNED'?'RECONFIRM':'INVITE',now);
  }s.phase='APPROVED';
 }else if(b.action==='respond'){
  if(s.phase!=='APPROVED')throw Error('승인된 일정에서 참석을 확인하세요.');respond(s.labor,b.jobId,b.workerId,b.response,now);
 }else if(b.action==='cancel'){
  if(s.phase!=='APPROVED')throw Error('승인된 계획이 없습니다.');
  s.history.push({at:now,event:'CANCELLED_PLAN_SNAPSHOT',detail:{missions:s.state.missions,reservations:s.reservations,reason:b.reason}});
  for(const job of s.labor.jobs.filter(j=>j.status==='OPEN')){for(const id of job.invited)notice(s.labor,job,id,'CANCELLED',now);job.status='STALE';job.assigned=[];}
  s.state.missions=[];s.reservations=[];s.phase='CANCELLED';s.draft=null;
 }
 s.history.push({at:now,event:b.action,detail:{phase:s.phase}});return s;
}
