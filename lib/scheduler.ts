import {isClosedTask} from './task-lifecycle';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {State,Diff} from './types';
import {restricted} from './weather';
export function snapshot(s:State){return createHash('sha256').update(JSON.stringify({planVersion:s.planVersion,fields:s.fields,machines:s.machines,missions:s.missions,events:s.events,ruleVersion:s.ruleVersion,staffCount:s.staffCount,transportCount:s.transportCount})).digest('hex');}
export function jobs(s:State){return s.missions.filter(m=>m.resourceId&&!isClosedTask(m.status)&&(!m.scheduledDate||(m.start>=0&&m.start<320)));}
const resultSchema=z.object({contractVersion:z.literal('weather-v2'),status:z.enum(['FEASIBLE','NO_FEASIBLE_PLAN']),assignments:z.array(z.object({missionId:z.string(),start:z.number().int().nonnegative(),duration:z.number().int().positive()})).optional(),reason:z.string().optional(),groups:z.number().optional()});
export async function solve(s:State,preferBatch=true,selectedIds:string[]=[]){
 const selected=new Set(selectedIds);
 const response=await fetch(`${process.env.SOLVER_URL??'http://127.0.0.1:8100'}/solve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobs:jobs(s).map(m=>({id:m.id,resourceId:m.resourceId,start:m.start,duration:m.duration,deadline:m.deadline,priority:m.priority,batchKey:m.batchKey,blockedWindows:[...s.events.filter(e=>restricted(s,m,e)).map(e=>[e.start,e.end]),...(selected.has(m.id)?[[0,(Math.floor(m.start/32)+1)*32]]:[])],fixedStart:s.events.length&&!selected.has(m.id)&&!s.events.some(e=>restricted(s,m,e))?m.start:null})),unavailable:s.machines.filter(m=>m.safetyLock||m.status!=='AVAILABLE').map(m=>m.id),staffCount:s.staffCount,transportCount:s.transportCount,preferBatch}),signal:AbortSignal.timeout(15000)});
 if(!response.ok) throw new Error('일정 계산 서비스에 연결할 수 없습니다. 확정하지 않았습니다.');
 const result=resultSchema.parse(await response.json());
 if(result.status==='NO_FEASIBLE_PLAN') return {feasible:false,diff:[] as Diff[],reason:result.reason??'작업 가능 창 부족',groups:0};
 const assignments=result.assignments??[];
 const all=jobs(s);
 if(assignments.length!==all.length||new Set(assignments.map(a=>a.missionId)).size!==all.length) throw new Error('계산 결과 작업 집합 불일치');
 const proposed=all.map(m=>{const a=assignments.find(a=>a.missionId===m.id); if(!a||a.duration!==m.duration)throw new Error('계산 결과 작업 길이 불일치');return {...m,start:a.start}});
 validate(s,proposed,selectedIds);
 for(const m of proposed)if(selected.has(m.id)&&m.start<(Math.floor(all.find(x=>x.id===m.id)!.start/32)+1)*32)throw new Error('선택 작업 재배치 날짜 위반');
 return {feasible:true,diff:proposed.filter(m=>m.start!==all.find(x=>x.id===m.id)!.start).map(m=>({missionId:m.id,before:all.find(x=>x.id===m.id)!.start,after:m.start,reason:'강풍 회피 및 장비·운송·인력 충돌 해소'})),groups:result.groups??all.length};
}
export function validate(s:State,proposed=jobs(s),selectedIds:string[]=[]){
 for(const m of proposed){
  if(!Number.isInteger(m.start)||m.start<0||m.start+m.duration>m.deadline||m.start%32+m.duration>32)throw new Error('마지막 안전일 또는 작업시간 위반');
  if(s.events.some(e=>restricted(s,m,e)&&m.start<e.end&&m.start+m.duration>e.start))throw new Error('강풍 금지창 위반');
  const original=s.missions.find(x=>x.id===m.id);
  if(s.events.length&&!selectedIds.includes(m.id)&&!s.events.some(e=>restricted(s,m,e))&&original&&m.start!==original.start)throw new Error('영향 없는 작업의 일정 변경 금지');
  const machine=s.machines.find(x=>x.id===m.resourceId);
  if(!machine||machine.safetyLock||machine.status!=='AVAILABLE')throw new Error('장비 안전잠금 또는 사용불가');
 }
 for(let t=0;t<320;t++){
  const active=proposed.filter(m=>m.start<=t&&t<m.start+m.duration);
  if(new Set(active.map(m=>m.resourceId)).size<active.length)throw new Error('장비 중복 예약');
  if(active.reduce((n,m)=>n+m.staff,0)>s.staffCount)throw new Error('인력 중복 예약');
  if(active.reduce((n,m)=>n+m.transport,0)>s.transportCount)throw new Error('운송 중복 예약');
 }
}
