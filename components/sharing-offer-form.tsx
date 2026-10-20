'use client';
import {centerText,equipmentText} from '@/lib/display-language';
import {useState} from 'react';
import {useLanguage} from './language';
export default function SharingOfferForm({data,busy,save,machineId}:{data:any;machineId?:string;busy:boolean;save:(value:any)=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [machine,setMachine]=useState(machineId??''),[borrower,setBorrower]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[targets,setTargets]=useState<string[]>([]),[out,setOut]=useState(2),[back,setBack]=useState(2),[ref,setRef]=useState(''),[conditions,setConditions]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [failed,setFailed]=useState(machineId??''),[failureDate,setFailureDate]=useState(''),[repairDate,setRepairDate]=useState('');
 if(!data?.canManage)return null;
 const centers=data.centers.filter((c:any)=>c.id===data.centerId||data.neighborCenterIds.includes(c.id)),owner=data.resources.filter((m:any)=>m.ownerCenterId===data.centerId&&(!machineId||m.id===machineId)),chosen=owner.find((m:any)=>m.id===machine);
 const name=(id:string)=>centerText(data.centers.find((c:any)=>c.id===id)?.name??id,locale);
 if(machineId&&!owner.length)return null;
 return <>
 {!machineId&&<p>{t('직접 인접 확인 센터','Verified adjacent centers')}: {data.neighborCenterIds.map(name).join(', ')||t('미확인','Not verified')} <button disabled={busy} onClick={()=>save({action:'refreshGeography'})}>{t('면 경계 갱신·인접 확인','Refresh boundaries')}</button></p>}
 <details><summary>{t('사전 허용 장비·공유 조건 관리','Pre-authorized equipment and sharing conditions')}</summary>
 <p>{t('장비는 하루 단위로 독점 차용합니다. 이동·상하차·복귀 시간을 제외한 시간에만 작업을 배치하며, 소유 센터에 작업·예약이 있는 날은 제외합니다. 추가 비용·조율이 필요한 경우 사전 허용하지 말고 개별 대여 신청을 이용하세요.','Equipment is lent exclusively by day. Transit, loading and return time are deducted; days booked by the owner are excluded. Use individual approval if extra costs or coordination are needed.')}</p>
 <form onSubmit={async e=>{e.preventDefault();await save({action:'sharingOffer',offer:{id:crypto.randomUUID(),version:0,machineId:machine,borrowerCenterId:borrower,from,to,compatibleMachineIds:targets,outboundSlots:out,returnSlots:back,agreementRef:ref,conditions,operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true}})}}>
 <div className="replan-fields">
 <label>{t('소유 장비','Owned equipment')}<select required value={machine} onChange={e=>{setMachine(e.target.value);setTargets([]);setConfirmed(false)}}><option value="">—</option>{owner.map((m:any)=><option key={m.id} value={m.id}>{m.id} · {equipmentText(m.type,locale)}</option>)}</select></label>
 <label>{t('사용 센터','Using center')}<select required value={borrower} onChange={e=>{setBorrower(e.target.value);setTargets([]);setConfirmed(false)}}><option value="">—</option>{centers.map((c:any)=><option key={c.id} value={c.id}>{centerText(c.name,locale)}{c.id===data.centerId?t(' · 센터 내 대체',' · local substitute'):''}</option>)}</select></label>
 <label>{t('허용 시작일','From')}<input required type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>{t('허용 종료일','Until')}<input required type="date" min={from} value={to} onChange={e=>setTo(e.target.value)}/></label>
 <label>{t('이동·상하차 (분)','Travel/loading (min)')}<input required type="number" min={0} max={240} step={15} value={out*15} onChange={e=>setOut(Number(e.target.value)/15)}/></label><label>{t('복귀 (분)','Return (min)')}<input required type="number" min={0} max={240} step={15} value={back*15} onChange={e=>setBack(Number(e.target.value)/15)}/></label>
 <label>{t('협약·내부 승인 근거','Agreement / authorization reference')}<input required maxLength={300} value={ref} onChange={e=>setRef(e.target.value)}/></label><label>{t('작업기·진입·운영자·운송 조건','Implement / access / operator / transport conditions')}<input required maxLength={500} value={conditions} onChange={e=>setConditions(e.target.value)}/></label>
 </div><fieldset><legend>{t('호환 확인된 대체 대상 장비','Compatible equipment to replace')}</legend>{data.resources.filter((m:any)=>m.ownerCenterId===borrower&&m.id!==machine&&m.type===chosen?.type&&m.capacityHaHour>0&&chosen?.capacityHaHour>0).map((m:any)=><label key={m.id}><input type="checkbox" checked={targets.includes(m.id)} onChange={e=>{setTargets(e.target.checked?[...targets,m.id]:targets.filter(id=>id!==m.id));setConfirmed(false)}}/>{m.id} </label>)}</fieldset>
 <label><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('호환성·운영자·운송을 확인했으며 위 조건 내 추가 승인 없이 사용을 허용합니다.','Compatibility, operator and transport are confirmed. Use within these conditions requires no additional approval.')}</label>
 <p><button disabled={busy||!confirmed||!targets.length}>{t('사전 허용 저장','Save authorization')}</button></p></form>
 <ul>{data.offers.map((o:any)=><li key={o.id}>{o.machineId} → {name(o.borrowerCenterId)} · {o.from} ~ {o.to} · {o.enabled?t('허용','Open'):t('중단','Closed')} {o.ownerCenterId===data.centerId&&o.enabled&&<button disabled={busy} onClick={()=>{const {ownerCenterId,...offer}=o;return save({action:'sharingOffer',offer:{...offer,enabled:false}})}}>{t('신규 자동 차용 중단','Stop new automatic loans')}</button>}</li>)}</ul>
 </details>
 <details><summary>{t('장비 고장·수리 예정 기록','Equipment failure and estimated repair')}</summary><form onSubmit={e=>{e.preventDefault();void save({action:'failure',machineId:failed,from:failureDate,expectedRepairOn:repairDate||undefined})}}><div className="replan-fields">
 <label>{t('고장 장비','Failed machine')}<select required value={failed} onChange={e=>setFailed(e.target.value)}><option value="">—</option>{owner.filter((m:any)=>m.status!=='MAINTENANCE').map((m:any)=><option key={m.id}>{m.id}</option>)}</select></label>
 <label>{t('고장 발생일','Failure date')}<input required type="date" value={failureDate} onChange={e=>setFailureDate(e.target.value)}/></label><label>{t('수리 예정일','Estimated repair date')}<input type="date" min={failureDate} value={repairDate} onChange={e=>setRepairDate(e.target.value)}/></label></div>
 <p>{t('수리 예정일이 지나도 자동 복구하지 않습니다. 실제 정비·안전 확인 후 장비 상태를 변경하세요.','Availability is not restored at the estimated date. Confirm actual repair and safety before updating equipment status.')}</p><button disabled={busy}>{t('고장 기록·영향 조회','Record failure and affected tasks')}</button></form></details>
 </>;
}
