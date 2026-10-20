'use client';
import {useCallback,useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import WorkspaceSidebar,{type WorkspaceView as View} from './workspace-sidebar';
import {useKoreaDay} from './use-korea-day';
import OperationsOverview,{type ScheduleNavigation} from './operations-overview';
import PersonalSettings from './personal-settings';
import LaborOperationsPanel from './labor-operations-panel';
import LaborWorkspace from './labor-workspace';
import Modal from './modal';
import FieldRegistration from './field-registration';
import EquipmentRegister from './equipment-register';
import OperatingRecords from './operating-records';
import {LanguageSelector,useLanguage} from './language';
import type {State} from '@/lib/types';
export default function Dashboard({initialRegistration=false,initialSettings=false}:{initialRegistration?:boolean;initialSettings?:boolean}){
 const currentDay=useKoreaDay();
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [data,setData]=useState<{state:State;aiMode:string}|null>(null),[view,setView]=useState<View>(initialSettings?'설정':'오늘'),[error,setError]=useState('');
 const [registration,setRegistration]=useState<'field'|'equipment'|'labor'|null>(initialRegistration?'field':null),[registrationBusy,setRegistrationBusy]=useState(false);
 const closeRegistration=()=>{if(registrationBusy)return;setRegistration(null);if(location.pathname==='/register')history.replaceState(null,'','/')};
 const [scheduleNavigation,setScheduleNavigation]=useState<ScheduleNavigation>({id:0,date:currentDay});
 function navigate(next:View,date=currentDay,allMonths=false){if(next==='일정표')setScheduleNavigation(prev=>({id:prev.id+1,date,allMonths}));setView(next);const url=new URL(location.href);const tabs:Record<View,string>={'오늘':'','일정표':'schedule','장비':'equipment','농지·농가':'fields','인력관리':'labor','설정':'settings','실적·통계':'reports'};if(tabs[next])url.searchParams.set('tab',tabs[next]);else url.searchParams.delete('tab');url.searchParams.delete('machine');url.searchParams.delete('field');url.searchParams.delete('section');history.replaceState(null,'',url)}
 const refresh=useCallback(async()=>{const r=await fetch('/api/workspace?workspace=sandbox',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setError('')},[]);
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const params=new URLSearchParams(location.search),tab=params.get('tab'),section=params.get('section');if(tab==='labor')setView('인력관리');if(tab==='production'||tab==='fields'){setView('농지·농가');if(tab==='production'||section==='production'){const url=new URL(location.href);url.searchParams.set('tab','fields');url.searchParams.set('section','planning');history.replaceState(null,'',url)}}if(tab==='reports')setView('실적·통계');if(tab==='settings')setView('설정');if(tab==='settings'&&section==='messages'){setView('인력관리');const url=new URL(location.href);url.searchParams.set('tab','labor');history.replaceState(null,'',url)}if(tab==='equipment'){setView('장비')}if(tab==='schedule')setView('일정표');if(tab==='farmer'||tab==='demo'){const url=new URL(location.href);url.searchParams.delete('tab');url.searchParams.delete('section');history.replaceState(null,'',url)}},[refresh]);
 if(!data)return <main className="main"><h1>K-Farm : Smart Harvest</h1><p>{error||t('자료를 불러오는 중입니다.','Loading…')}</p><button onClick={()=>refresh().catch(e=>setError(e.message))}>{t('다시 연결','Reconnect')}</button></main>;
 const s=data.state;
 const labels:Record<View,string>={'오늘':t('지원현황','Operations overview'),'일정표':t('일정표','Schedule'),'장비':t('장비현황','Equipment'),'농지·농가':t('농지관리','Field management'),'인력관리':t('인력관리','Labor'),'설정':t('설정','Settings'),'실적·통계':t('실적·통계','Results and statistics')};
 const hasDemo=!!s.demoResourceBatchId||s.fields.some(f=>f.source==='DEMO_ASSUMPTION');
 return <div className="shell"><WorkspaceSidebar active={view} onNavigate={navigate}/><div className="content"><header className="topbar"><strong className="center-name">{t(data.state.name,({demo:'Gyebuk',janggye:'Janggye',cheoncheon:'Cheoncheon',gyenam:'Gyenam'} as Record<string,string>)[data.state.centerSharing?.centerId??'demo']+'-myeon Agriculture Support Center')}</strong><div className="online temporary-status" data-testid="workspace-status"><span className="badge">{data.aiMode==='NEBIUS'?t('AI 연결','AI connected'):t('AI 미연결','AI disconnected')}</span><time dateTime={currentDay}>{currentDay}</time><button aria-label={t('새로고침','Refresh')} onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw size={16}/></button></div><LanguageSelector/></header><main className="main"><div className="page-heading"><h1>{labels[view]}</h1></div>{error&&<p role="alert">{error}</p>}
 <OperationsOverview aiAvailable={data.aiMode==='NEBIUS'} state={s} view={view} onView={navigate} scheduleNavigation={scheduleNavigation} onRefresh={refresh} onRegister={setRegistration}/>
 {registration==='field'&&<Modal title={t('신규 농지 등록','Register new field')} onClose={closeRegistration}><FieldRegistration onSaved={refresh} onBusy={setRegistrationBusy}/></Modal>}
 {registration==='equipment'&&<EquipmentRegister registrationOnly state={s} onRefresh={refresh} statusOf={m=>m.status} onClose={closeRegistration}/>}
 {registration==='labor'&&<LaborOperationsPanel embedded registrationOnly onClose={closeRegistration}/>}
 {view==='인력관리'&&<LaborWorkspace/>}
 {view==='실적·통계'&&<OperatingRecords/>}
 {view==='설정'&&<PersonalSettings/>}
 </main></div></div>;
}
