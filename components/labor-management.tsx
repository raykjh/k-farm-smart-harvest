'use client';
import {useEffect,useState} from 'react';
import {LanguageSelector,useLanguage} from './language';
import {allocateLabor,type LaborCandidate} from '@/lib/labor';

export default function LaborManagement(){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [people,setPeople]=useState<LaborCandidate[]>([]),[name,setName]=useState(''),[distance,setDistance]=useState('');
 const [count,setCount]=useState(2),[date,setDate]=useState(''),[task,setTask]=useState(''),[hours,setHours]=useState(''),[pay,setPay]=useState('');
 const [opened,setOpened]=useState(false),[confirmed,setConfirmed]=useState(false);
 const space='sandbox' as const;
 const [version,setVersion]=useState(0),[busy,setBusy]=useState(true),[ready,setReady]=useState(false),[message,setMessage]=useState('');
 const apply=(d:any)=>{setPeople(d.people);setCount(d.count);setDate(d.date);setTask(d.task);setHours(d.hours);setPay(d.pay);setOpened(d.opened);setConfirmed(d.confirmed)};
 async function load(space:'operations'|'sandbox'){setBusy(true);setReady(false);try{const r=await fetch('/api/labor?workspace='+space,{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();apply(d.payload);setVersion(d.version);setReady(true);setMessage('')}catch{setMessage(t('저장 자료를 불러오지 못했습니다. 저장은 비활성화됩니다.','Load failed. Saving is disabled.'))}finally{setBusy(false)}}
 useEffect(()=>{const value='sandbox';void load(value)},[]);
 async function save(){setBusy(true);try{const r=await fetch('/api/labor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:space,version,payload:{people,count,date,task,hours,pay,opened,confirmed}})});const d=await r.json();if(!r.ok)throw Error(d.error);setVersion(d.version);setMessage(t('저장 완료','Saved'))}catch(e){setMessage(e instanceof Error?e.message:t('저장 실패','Save failed'))}finally{setBusy(false)}}
 const result=allocateLabor(people,count);
 function change(id:string,patch:Partial<LaborCandidate>){setPeople(ps=>ps.map(p=>p.id===id?{...p,...patch}:p));setConfirmed(false)}
 return <main className="main" style={{maxWidth:1200,margin:'auto'}}><LanguageSelector/><a href="/">← {t('메인','Main')}</a><h1>{t('인력관리','Labor management')}</h1>
 <p className="notice">{t('로컬 저장 기능입니다. 로그인·권한·개인정보 운영 정책 확정 전에는 실제 개인정보를 입력하지 마세요. 문자·급여 지급은 연결되지 않았습니다.','Local persistence. Do not enter real personal data before authentication and privacy controls are ready. SMS and payroll are disconnected.')}</p>
 <div className="actions"><button disabled={busy||!ready} onClick={save}>{t('변경사항 저장','Save changes')}</button><button disabled={busy} onClick={()=>{if(window.confirm(t('저장하지 않은 변경을 버리고 다시 불러올까요?','Discard unsaved changes and reload?')))void load(space)}}>{t('다시 불러오기','Reload saved data')}</button><span>v{version}</span></div>{message&&<p role="status">{message}</p>}
 <fieldset disabled={busy||!ready} style={{border:0,padding:0,minWidth:0}}>
 <section className="card section-space"><h2>{t('참여 희망자 등록','Register volunteers')}</h2><p>{t('농부가 아닌 지역 주민도 신청할 수 있습니다. 작업 가능 여부를 먼저 확인하며 연령만으로 작업을 배정하지 않습니다.','Local residents may apply regardless of farmer status. Check task suitability; age alone does not determine assignment.')}</p>
 <form className="form-grid" onSubmit={e=>{e.preventDefault();if(!name.trim())return;setPeople(ps=>[...ps,{id:crypto.randomUUID(),name:name.trim(),score:100,distanceKm:distance===''?null:Number(distance),recentAssignments:0,eligible:false,response:'NONE'}]);setName('');setDistance('');setConfirmed(false)}}>
 <label>{t('이름 또는 내부 식별명','Name or internal alias')}<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>{t('작업 농지까지 거리 (km, 모르면 비움)','Distance to work field (km, blank if unknown)')}<input type="number" min="0" max="1000" step="0.1" value={distance} onChange={e=>setDistance(e.target.value)}/></label><button className="badge" type="submit">{t('희망자 추가','Add volunteer')}</button></form>
 </section>
 <section className="card section-space"><h2>{t('일일 인력 요청','Daily labor request')}</h2><div className="form-grid">
 <label>{t('작업일','Date')}<input type="date" disabled={opened} value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label>{t('농지·작업 내용','Field and task')}<input disabled={opened} value={task} onChange={e=>setTask(e.target.value)}/></label>
 <label>{t('작업시간 안내','Work hours')}<input disabled={opened} value={hours} onChange={e=>setHours(e.target.value)}/></label>
 <label>{t('보수 안내','Pay information')}<input disabled={opened} value={pay} onChange={e=>setPay(e.target.value)}/></label>
 <label>{t('필요 인원','Required people')}<input type="number" min="1" max="100" value={count} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=100){setCount(n);setConfirmed(false)}}}/></label></div>
 <button className="badge" disabled={opened||!date||!task.trim()||!hours.trim()||!pay.trim()} onClick={()=>setOpened(true)}>{t('모집 안내 작성','Prepare invitation')}</button>
 {opened&&<p role="status">{date} · {task} · {hours} · {pay} — {t('신청은 배정 확정이 아닙니다.','Applying does not confirm assignment.')}</p>}
 </section>
 <section className="card section-space"><h2>{t('참석 의사와 배정','Responses and allocation')}</h2><p>{t('작업 가능 확인 + 참석 신청자만 추천합니다. 점수 높은 순 → 가까운 순 → 최근 배정 적은 순. 미응답·미신청은 감점하지 않습니다. 거리는 등록 출발지 기준이며 현재는 수동 입력값입니다.','Only suitable applicants are ranked: score descending → distance ascending → fewer recent assignments. No penalty for silence or not applying. Distance is manually entered from the registered starting point, not live tracking.')}</p>
 <div className="table-wrap"><table><thead><tr>{[t('이름','Name'),t('점수','Score'),t('거리','Distance'),t('작업 가능 확인','Suitability checked'),t('참석 신청 경로','Application channel'),t('상태','Status')].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{people.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.score}</td><td>{p.distanceKm??'—'} km</td><td><input aria-label={`${p.name} eligibility`} type="checkbox" checked={p.eligible} onChange={e=>change(p.id,{eligible:e.target.checked})}/></td><td><select aria-label={`${p.name} response`} disabled={!opened} value={p.response} onChange={e=>change(p.id,{response:e.target.value as LaborCandidate['response']})}><option value="NONE">{t('미신청','Not applied')}</option><option value="APP">{t('참석 버튼 (모의)','Attendance button (simulated)')}</option><option value="PHONE">{t('전화 신청 · 담당자 기록 (모의)','Phone application · staff entry (simulated)')}</option></select></td><td>{confirmed?(result.selected.some(x=>x.id===p.id)?t('배정 확정','Assigned'):result.waiting.some(x=>x.id===p.id)?t('대기','Waiting'):t('배정 제외','Not assigned')):t('미확정','Unconfirmed')}</td></tr>)}</tbody></table></div>
 <p>{t('신청 인원','Applicants')}: {people.filter(p=>p.response!=='NONE').length} / {t('배정 가능','Assignable')}: {result.selected.length} / {t('부족','Shortage')}: {result.shortage}</p>
 <button className="badge" disabled={!opened||!result.selected.length||confirmed} onClick={()=>setConfirmed(true)}>{t('담당자 일괄 확정','Staff batch confirmation')}</button>
 {confirmed&&<p role="status">{t('확정 안내 미리보기','Confirmation preview')}: {result.selected.map(p=>p.name).join(', ')} · {t('실제 알림은 발송하지 않았습니다. 결원은 대기자 의사를 다시 확인한 뒤 배정합니다.','No actual messages sent. Reconfirm waitlisted volunteers before filling vacancies.')}</p>}
 <p className="description">{t('초기 점수는 모두 100점입니다. 자동 감점은 없으며 구체적인 감점·소명·회복 절차는 별도 확정 후 연결합니다. 외부 충원·급여 지급·근무 실적 저장은 미연결입니다.','Everyone starts at 100. No automatic penalties; review and recovery rules remain to be defined. External staffing, payroll and work-history storage are not connected.')}</p>
 </section></fieldset></main>;
}
