import {isClosedTask} from './task-lifecycle';
import type {State,Mission} from './types';
import {snapshot} from './scheduler';
import {restricted} from './weather';
const base=Date.parse('2026-09-09T00:00:00Z'),dayMs=86400000;
const day=(v:string)=>Date.parse(v+'T00:00:00Z');
export function taskScheduleOptions(s:State,id:string,preferred:string){
 const m=s.missions.find(m=>m.id===id);if(!m)throw Error('작업을 찾을 수 없습니다.');
 if(isClosedTask(m.status))throw Error('완료된 작업 이력은 변경하지 않습니다.');
 if(s.ruleVersion!=='gyebuk-2026-30-v1')throw Error('작업 가능 기간이 검증되지 않아 변경할 수 없습니다.');
 if(!/^2026-\d{2}-\d{2}$/.test(preferred)||!Number.isFinite(day(preferred))||new Date(day(preferred)).toISOString().slice(0,10)!==preferred)throw Error('2026년의 유효한 희망일을 입력하세요.');
 const original=m.originalScheduledDate??m.scheduledDate;if(!original)throw Error('기존 작업일이 필요합니다.');
 // Provisional scenario window only. Never claim this is an agronomic safe window.
 const same=s.missions.filter(x=>x.fieldId===m.fieldId&&x.id!==id&&x.scheduledDate);
 const prev=same.filter(x=>x.scheduledDate!<original).sort((a,b)=>b.scheduledDate!.localeCompare(a.scheduledDate!))[0];
 const next=same.filter(x=>x.scheduledDate!>original).sort((a,b)=>a.scheduledDate!.localeCompare(b.scheduledDate!))[0];
 const low=Math.max(base,day(original)-7*dayMs,prev?day(prev.scheduledDate!)+dayMs:0),high=Math.min(day(original)+7*dayMs,next?day(next.scheduledDate!)-dayMs:Infinity);
 const options:{date:string;start:number;label:string}[]=[];
 for(const delta of [0,-1,1,-2,2]){
  const time=day(preferred)+delta*dayMs;if(time<low||time>high)continue;
  const date=new Date(time).toISOString().slice(0,10),offset=(time-base)/dayMs*32;
  const machine=s.machines.find(x=>x.id===m.resourceId);if(m.resourceId&&(!machine||machine.safetyLock||machine.status!=='AVAILABLE'))continue;
  for(let hour=0;hour+m.duration<=32;hour++){
   const start=offset+hour;
   if(s.events.some(e=>restricted(s,m,e)&&start<e.end&&start+m.duration>e.start))continue;
   const peers=s.missions.filter(x=>x.id!==id&&x.scheduledDate===date&&!isClosedTask(x.status));
   let valid=true;
   for(let slot=start;slot<start+m.duration;slot++){
    const active=peers.filter(x=>x.start<=slot&&slot<x.start+x.duration);
    if(m.resourceId&&active.some(x=>x.resourceId===m.resourceId)){valid=false;break;}
    if(m.owner==='농부'&&active.some(x=>x.fieldId===m.fieldId&&x.owner==='농부')){valid=false;break;}
    const staff=(x:Mission)=>x.owner==='농부'?0:Math.max(1,x.staff);
    if(active.reduce((n,x)=>n+staff(x),staff(m))>s.staffCount||active.reduce((n,x)=>n+x.transport,m.transport)>s.transportCount){valid=false;break;}
   }
   if(valid){const minutes=480+hour*15;options.push({date,start,label:date+' '+String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')});break;}
  }
 }
 return {token:snapshot(s),options,window:{from:new Date(low).toISOString().slice(0,10),to:new Date(high).toISOString().slice(0,10)},basis:'SCENARIO_WINDOW_NOT_VERIFIED_AGRONOMIC_LIMIT'};
}
