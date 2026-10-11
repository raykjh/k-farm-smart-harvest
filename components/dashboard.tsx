'use client';
import {useCallback,useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import WorkspaceSidebar,{type WorkspaceView as View} from './workspace-sidebar';
import {useKoreaDay} from './use-korea-day';
import OperationsOverview,{type ScheduleNavigation} from './operations-overview';
import DevelopmentWeather from './development-weather';
import PlanChangeLog from './plan-change-log';
import DataSettings from './data-settings';
import CultivationPanel from './cultivation-panel';
import ContinuousProductionPanel from './continuous-production-panel';
import CenterSettings from './center-settings';
import CropReferencePanel from './crop-reference-panel';
import CapacityStudyPanel from './capacity-study-panel';
import LaborOperationsPanel from './labor-operations-panel';
import Modal from './modal';
import FieldRegistration from './field-registration';
import EquipmentRegister from './equipment-register';
import WorkReports from './work-reports';
import ExecutionRecordEditor from './execution-record-editor';
import {LanguageSelector,useLanguage,localized} from './language';
import type {State,Notice} from '@/lib/types';
export default function Dashboard({initialRegistration=false,initialSettings=false}:{initialRegistration?:boolean;initialSettings?:boolean}){
 const currentDay=useKoreaDay();
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [data,setData]=useState<{state:State;notices:Notice[];aiMode:string}|null>(null),[view,setView]=useState<View>(initialSettings?'설정':'오늘'),[error,setError]=useState(''),[productionTab,setProductionTab]=useState('ongoing'),[farmer,setFarmer]=useState(''),[farmerTab,setFarmerTab]=useState('notices');
 const [registration,setRegistration]=useState<'field'|'equipment'|'labor'|null>(initialRegistration?'field':null),[registrationBusy,setRegistrationBusy]=useState(false);
 const closeRegistration=()=>{if(registrationBusy)return;setRegistration(null);if(location.pathname==='/register')history.replaceState(null,'','/')};
 const [scheduleNavigation,setScheduleNavigation]=useState<ScheduleNavigation>({id:0,date:currentDay});
 function navigate(next:View,date=currentDay,allMonths=false){if(next==='일정표')setScheduleNavigation(prev=>({id:prev.id+1,date,allMonths}));setView(next);const url=new URL(location.href);const tabs:Record<View,string>={'오늘':'','일정표':'schedule','장비':'equipment','농지·농가':'fields','생산관리':'production','인력관리':'labor','데모':'demo','설정':'settings','농부 화면':'farmer','실적·통계':'reports'};if(tabs[next])url.searchParams.set('tab',tabs[next]);else url.searchParams.delete('tab');url.searchParams.delete('machine');history.replaceState(null,'',url)}
 const refresh=useCallback(async()=>{const r=await fetch('/api/workspace?workspace=sandbox',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setError('')},[]);
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const tab=new URLSearchParams(location.search).get('tab');if(tab==='labor')setView('인력관리');if(tab==='production')setView('생산관리');if(tab==='demo')setView('데모');if(tab==='reports')setView('실적·통계');if(tab==='settings')setView('설정');if(tab==='equipment')setView('장비');if(tab==='schedule')setView('일정표');if(tab==='fields')setView('농지·농가');if(tab==='farmer')setView('농부 화면')},[refresh]);
 if(!data)return <main className="main"><h1>K-Farm : Smart Harvest</h1><p>{error||t('자료를 불러오는 중입니다.','Loading…')}</p><button onClick={()=>refresh().catch(e=>setError(e.message))}>{t('다시 연결','Reconnect')}</button></main>;
 const s=data.state,mine=s.fields.find(f=>f.farmerId===farmer)??s.fields[0];
 const labels:Record<View,string>={'오늘':t('지원현황','Operations overview'),'일정표':t('일정표','Schedule'),'장비':t('장비현황','Equipment'),'농지·농가':t('농지','Fields'),'생산관리':t('생산관리','Production'),'인력관리':t('인력관리','Labor'),'데모':t('데모','Demo'),'설정':t('설정','Settings'),'농부 화면':t('농부 화면','Farmer view'),'실적·통계':t('실적·통계','Results and statistics')};
 const hasDemo=!!s.demoResourceBatchId||s.fields.some(f=>f.source==='DEMO_ASSUMPTION');
 return <div className="shell"><WorkspaceSidebar active={view} onNavigate={navigate}/><div className="content"><header className="topbar"><strong className="center-name">{t(data.state.name,({demo:'Gyebuk',janggye:'Janggye',cheoncheon:'Cheoncheon',gyenam:'Gyenam'} as Record<string,string>)[data.state.centerSharing?.centerId??'demo']+'-myeon Agriculture Support Center')}</strong><div className="online temporary-status" data-testid="workspace-status"><span className="badge">{data.aiMode==='NEBIUS'?t('AI 연결','AI connected'):t('AI 미연결','AI disconnected')}</span>{hasDemo&&<span className="badge warn">{t('데모데이터','Demo data')}</span>}<time dateTime={currentDay}>{currentDay}</time><button aria-label={t('새로고침','Refresh')} onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw size={16}/></button></div><LanguageSelector/></header><main className="main"><div className="page-heading"><h1>{labels[view]}</h1></div>{error&&<p role="alert">{error}</p>}
 <OperationsOverview state={s} view={view} onView={navigate} scheduleNavigation={scheduleNavigation} onRefresh={refresh} onRegister={setRegistration}/>
 {registration==='field'&&<Modal title={t('신규 농지 등록','Register new field')} onClose={closeRegistration}><FieldRegistration onSaved={refresh} onBusy={setRegistrationBusy}/></Modal>}
 {registration==='equipment'&&<EquipmentRegister registrationOnly state={s} onRefresh={refresh} statusOf={m=>m.status} onClose={closeRegistration}/>}
 {registration==='labor'&&<LaborOperationsPanel embedded registrationOnly onClose={closeRegistration}/>}
 {view==='생산관리'&&<><div className="view-tabs">{[['ongoing',t('생산현황','Production overview')],['cultivations',t('재배기록','Cultivation records')],['references',t('작물 기준자료','Crop references')],['capacity',t('30작물·자원계획','30 crops / resources')]].map(([key,label])=><button key={key} aria-pressed={productionTab===key} onClick={()=>setProductionTab(key)}>{label}</button>)}</div>{productionTab==='ongoing'?<ContinuousProductionPanel onSaved={refresh}/>:productionTab==='cultivations'?<CultivationPanel onSaved={refresh}/>:productionTab==='capacity'?<CapacityStudyPanel/>:<CropReferencePanel embedded/>}</>}
 {view==='인력관리'&&<LaborOperationsPanel embedded/>}
 {view==='실적·통계'&&<><WorkReports/><ExecutionRecordEditor/></>}
 {view==='데모'&&<><p className="notice">{t('상황 실험과 가상 실적을 관리합니다. 실제 장비 명령·문자 발송은 연결되지 않았습니다.','Simulation and synthetic execution history. Real device commands and SMS are not connected.')}</p><DevelopmentWeather state={s} onRefresh={refresh}/><PlanChangeLog version={s.planVersion} onDelivered={refresh}/><DataSettings embedded onSaved={refresh}/></>}
 {view==='설정'&&<><section className="card"><div className="settings-links"><a href="/password">{t('비밀번호·복구','Password and recovery')}</a><a href="/reservations">{t('센터 간 장비 예약','Shared equipment reservations')}</a><button onClick={()=>setView('농부 화면')}>{t('농부 화면','Farmer view')}</button></div></section><CenterSettings onSaved={refresh} onEquipment={()=>navigate('장비')}/></>}
 {view==='농부 화면'&&(mine?localized(<section className="phone"><label>농가 <select aria-label="농가 선택" value={mine.farmerId} onChange={e=>setFarmer(e.target.value)}>{s.fields.filter((f,i,all)=>all.findIndex(x=>x.farmerId===f.farmerId)===i).map(f=><option key={f.farmerId} value={f.farmerId}>{f.name}</option>)}</select></label><h2>{mine.name}</h2><div className="stack section-space">{[['notices','알림 보기'],['plan','올해 농사계획'],['call','지원센터에 전화하기']].map(([key,label])=><button key={key} onClick={()=>setFarmerTab(key)}>{label}</button>)}</div>{farmerTab==='notices'?<>{data.notices.filter(n=>n.farmerId===mine.farmerId&&n.status==='DELIVERED').map(n=><article className="card" key={n.id}><p>{n.body}</p></article>)}{!data.notices.some(n=>n.farmerId===mine.farmerId&&n.status==='DELIVERED')&&<p>아직 도착한 알림이 없습니다.</p>}</>:farmerTab==='plan'?s.missions.filter(m=>s.fields.some(f=>f.farmerId===mine.farmerId&&f.id===m.fieldId)).map(m=><article className="card" key={m.id}><h3>{m.scheduledDate} · {m.label}</h3><p>{m.owner==='농부'?'농부님이 하실 일':'지원센터가 준비해요'}</p></article>):<p>지원센터 전화번호는 아직 등록되지 않았습니다.</p>}</section>,locale):<p>{t('등록된 농부가 없습니다.','No registered farmers.')}</p>)}
 </main></div></div>;
}
