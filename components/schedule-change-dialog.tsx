'use client';
import {useState} from 'react';
import type {State} from '@/lib/types';
import type {EquipmentDowntime} from '@/lib/equipment-downtime';
import {immovable} from '@/lib/replan-scope';
import {useLanguage} from './language';
import {equipmentLabel} from '@/lib/schedule-display';
import ReplanManager from './replan-manager';
const nextDay=(day:string,n=1)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const reasons=[['기상 부적합','Unsuitable weather'],['장비 문제','Equipment problem'],['기타 변경','Other change']] as const;
export default function ScheduleChangeDialog({state,today,eligibleIds,initialDate,initialIds,aiAvailable=false,ready=true,taskSheet=false,onClose,onSaved,onUpdated}:{state:State;today:string;eligibleIds:string[];initialDate?:string;initialIds?:string[];aiAvailable?:boolean;ready?:boolean;taskSheet?:boolean;onClose:()=>void;onSaved:()=>Promise<void>;onUpdated?:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 // Source work comes from the calendar selection, never the desired new date.
 const day=initialDate??today;
 const selected=state.missions.filter(m=>eligibleIds.includes(m.id)&&!immovable(m)&&String(m.status)!=='WORKING'&&m.scheduledDate===day&&(!initialIds||initialIds.includes(m.id)));
 const owned=state.machines.filter(m=>!m.ownerCenterId||m.ownerCenterId===(state.centerSharing?.centerId??'demo'));
 const selectedMachines=owned.filter(m=>selected.some(task=>task.resourceId===m.id));
 const machineOptions=selectedMachines.length?selectedMachines:owned;
 const [reason,setReason]=useState<string>(taskSheet?'':'기타 변경'),[preferred,setPreferred]=useState('');
 const [chosenMachine,setMachine]=useState(''),[from,setFrom]=useState(today),[returnOn,setReturn]=useState(nextDay(today,7));
 const fault=reason==='장비 문제',machineId=chosenMachine||(machineOptions.length===1?machineOptions[0].id:'');
 const tasks=fault?state.missions.filter(m=>eligibleIds.includes(m.id)&&!immovable(m)&&String(m.status)!=='WORKING'&&m.resourceId===machineId&&m.scheduledDate&&from<=m.scheduledDate&&m.scheduledDate<returnOn):selected;
 const request:{ids:string[];day?:string;deferAfter?:string;outage?:EquipmentDowntime}=fault?{ids:tasks.map(m=>m.id),deferAfter:today,outage:{machineId,from,returnOn}}:{ids:tasks.map(m=>m.id),day,deferAfter:today};
 const invalid=!ready||!tasks.length||(fault&&(!machineId||!from||!returnOn||from>=returnOn));
 return <ReplanManager embedded taskSheet={taskSheet} disabled={invalid||!reason} formValues={{reason,preferred}} simple aiAvailable={aiAvailable} state={state} {...request} onClose={onClose} onSaved={onSaved} onUpdated={onUpdated}>
  <div className="replan-fields schedule-change-fields">
   <label>{t('변경 희망일 (선택)','Preferred date (optional)')}<input aria-label={t('변경 희망일 (선택)','Preferred date (optional)')} type="date" min={nextDay(today)} value={preferred} onChange={e=>setPreferred(e.target.value)}/><small>{t('미입력 시 내일부터 자동 배치 · 입력 시 해당일 또는 가까운 날','Blank: from tomorrow · Selected: that date or nearby')}</small></label>
   <label>{t('변경 사유를 선택해주세요','Select a reason')}<select aria-label={t('변경 사유를 선택해주세요','Select a reason')} value={reason} onChange={e=>setReason(e.target.value)}><option value="">{t('선택해주세요','Select')}</option>{reasons.map(([ko,en])=><option key={ko} value={ko}>{t(ko,en)}</option>)}</select></label>
  </div>
  {fault&&<div className="registration-grid schedule-change-fields">
   {machineOptions.length===1?<p className="schedule-change-equipment">{equipmentLabel(machineOptions[0],machineOptions[0].id,locale==='ko')}</p>:<label className="schedule-change-equipment">{t('문제 장비','Affected equipment')}<select aria-label={t('문제 장비','Affected equipment')} value={machineId} onChange={e=>setMachine(e.target.value)}><option value="">{t('선택','Select')}</option>{machineOptions.map(m=><option key={m.id} value={m.id}>{equipmentLabel(m,m.id,locale==='ko')}</option>)}</select></label>}
   <label>{t('입고일','Repair starts')}<input aria-label={t('입고일','Repair starts')} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>{t('출고 예정일','Expected release')}<input aria-label={t('출고 예정일','Expected release')} type="date" min={from?nextDay(from):undefined} value={returnOn} onChange={e=>setReturn(e.target.value)}/></label>
  </div>}
  {ready&&!tasks.length&&(!fault||machineId)&&<p role="status">{t('변경할 작업이 없습니다.','No work to reschedule.')}</p>}
 </ReplanManager>;
}
