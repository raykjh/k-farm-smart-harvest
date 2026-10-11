'use client';
import {Sprout,LayoutDashboard,CalendarDays,Tractor,MapPinned,Bell,Users,FlaskConical,Settings,ClipboardList,BookOpen,Wrench} from 'lucide-react';
import {useLanguage} from './language';
export type WorkspaceView='오늘'|'일정표'|'장비'|'농지·농가'|'생산관리'|'인력관리'|'데모'|'설정'|'농부 화면'|'실적·통계';
const destinations=[
 ['오늘','Main','/',LayoutDashboard],['일정표','Schedule','/?tab=schedule',CalendarDays],
 ['장비','Equipment','/?tab=equipment',Tractor],['농지·농가','Fields','/?tab=fields',MapPinned],
 ['생산관리','Production','/?tab=production',Sprout],['인력관리','Labor','/?tab=labor',Users],
 ['실적·통계','Results and statistics','/?tab=reports',ClipboardList],
 ['데모','Demo','/?tab=demo',FlaskConical],['설정','Settings','/?tab=settings',Settings],
 ['농부 화면','Farmer view','/?tab=farmer',Bell],
] as const;
export default function WorkspaceSidebar({active,onNavigate,globalOnly=false}:{active:WorkspaceView|'crop-info'|'equipment-info';onNavigate?:(view:WorkspaceView)=>void;globalOnly?:boolean}){
 const {locale}=useLanguage(),ko=locale==='ko';
 return <aside className="sidebar"><a className="logo" href={globalOnly?'/accounts':'/'}><span className="logo-mark"><Sprout size={24}/></span><span>K-Farm<small className="brand-subtitle">: Smart Harvest</small></span></a>
 <nav className="nav" aria-label={ko?'주 메뉴':'Main navigation'}>
 {!globalOnly&&destinations.map(([key,en,url,Icon])=>{const props={className:`${active===key?'active':''} ${key==='농부 화면'?'nav-child':''}`,'aria-current':active===key?'page' as const:undefined};const text=ko?key==='오늘'?'메인':key==='농지·농가'?'농지':key==='장비'?'장비현황':key:en;return onNavigate?<button key={key} {...props} onClick={()=>onNavigate(key)}><Icon size={19}/>{text}</button>:<a key={key} {...props} href={url}><Icon size={19}/>{text}</a>})}
 <span className="nav-section-label">{ko?'기준정보':'Reference library'}</span>
 <a className={active==='crop-info'?'active':''} aria-current={active==='crop-info'?'page':undefined} href="/crop-info"><BookOpen size={19}/>{ko?'작물정보':'Crop information'}</a>
 <a className={active==='equipment-info'?'active':''} aria-current={active==='equipment-info'?'page':undefined} href="/equipment-info"><Wrench size={19}/>{ko?'장비정보':'Equipment information'}</a>
 {globalOnly&&<a href="/accounts"><Users size={19}/>{ko?'계정 관리':'Accounts'}</a>}
 </nav></aside>;
}
