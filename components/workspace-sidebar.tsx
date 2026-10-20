'use client';
import {Sprout,LayoutDashboard,CalendarDays,Tractor,MapPinned,Users,Settings,ClipboardList,BookOpen,Wrench,Thermometer,Globe,ChartNoAxesCombined,Calculator,ChartColumn} from 'lucide-react';
import type {InformationKind} from './information-shared';
import {useLanguage} from './language';
export type WorkspaceView='오늘'|'일정표'|'장비'|'농지·농가'|'인력관리'|'설정'|'실적·통계';
const destinations=[
 ['오늘','Main','/',LayoutDashboard],['일정표','Schedule','/?tab=schedule',CalendarDays],
 ['장비','Equipment','/?tab=equipment',Tractor],['농지·농가','Field management','/?tab=fields',MapPinned],
 ['인력관리','Labor','/?tab=labor',Users],
 ['실적·통계','Results and statistics','/?tab=reports',ClipboardList],
 ['설정','Settings','/?tab=settings',Settings],
] as const;
export default function WorkspaceSidebar({active,onNavigate,globalOnly=false}:{active:WorkspaceView|InformationKind;onNavigate?:(view:WorkspaceView)=>void;globalOnly?:boolean}){
 const {locale}=useLanguage(),ko=locale==='ko';
 return <aside className="sidebar"><a className="logo" href={globalOnly?'/accounts':'/'}><span className="logo-mark"><Sprout size={24}/></span><span>K-Farm<small className="brand-subtitle">: Smart Harvest</small></span></a>
 <nav className="nav" aria-label={ko?'주 메뉴':'Main navigation'}>
 {!globalOnly&&destinations.map(([key,en,url,Icon])=>{const props={className:active===key?'active':'','aria-current':active===key?'page' as const:undefined};const text=ko?key==='오늘'?'메인':key==='농지·농가'?'농지관리':key==='장비'?'장비현황':key:en;return onNavigate?<button key={key} {...props} onClick={()=>onNavigate(key)}><Icon size={19}/>{text}</button>:<a key={key} {...props} href={url}><Icon size={19}/>{text}</a>})}
 <a className={active==='national'?'active':''} aria-current={active==='national'?'page':undefined} href="/national"><Globe size={19}/>{ko?'전국 현황':'National overview'}</a>
 <span className="nav-section-label">{ko?'기준정보':'Reference library'}</span>
 <a className={active==='price-info'?'active':''} aria-current={active==='price-info'?'page':undefined} href="/price-info"><ChartNoAxesCombined size={19}/>{ko?'가격정보':'Prices'}</a>
 <a className={active==='cost-info'?'active':''} aria-current={active==='cost-info'?'page':undefined} href="/cost-info"><Calculator size={19}/>{ko?'비용·경제성':'Costs and economics'}</a>
 <a className={active==='supply-info'?'active':''} aria-current={active==='supply-info'?'page':undefined} href="/supply-info"><ChartColumn size={19}/>{ko?'수급정보':'Supply outlook'}</a>
 <a className={active==='crop-info'?'active':''} aria-current={active==='crop-info'?'page':undefined} href="/crop-info"><BookOpen size={19}/>{ko?'작물정보':'Crop information'}</a>
 <a className={active==='equipment-info'?'active':''} aria-current={active==='equipment-info'?'page':undefined} href="/equipment-info"><Wrench size={19}/>{ko?'장비정보':'Equipment information'}</a>
 {!globalOnly&&<a className={active==='temperature-info'?'active':''} aria-current={active==='temperature-info'?'page':undefined} href="/temperature-info"><Thermometer size={19}/>{ko?'기후정보':'Climate information'}</a>}
 {globalOnly&&<a className={active==='prepared-inputs'?'active':''} href="/prepared-inputs"><ClipboardList size={19}/>{ko?'가공 입력 관리':'Prepared inputs'}</a>}
 {globalOnly&&<a href="/accounts"><Users size={19}/>{ko?'계정 관리':'Accounts'}</a>}
 </nav></aside>;
}
