'use client';
import {useState} from 'react';
import {useLanguage} from './language';
import {confirmedAttendanceCount} from '@/lib/labor-attendance-review';
import type {LaborJob} from '@/lib/labor-operations';
export default function LaborCalendar({demands,jobs,onDay}:{demands:any[];jobs:LaborJob[];onDay:(date:string)=>void}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),year=Number(today.slice(0,4)),month=Number(today.slice(5,7)),[offset,setOffset]=useState(0);
 return <section className="labor-calendar-section" aria-label={t('인력 달력','Labor calendar')}><div className="actions labor-calendar-controls"><button onClick={()=>setOffset(n=>n-1)}>{t('이전 달 보기','Previous month')}</button><button onClick={()=>setOffset(0)}>{t('이번 달','This month')}</button><button onClick={()=>setOffset(n=>n+1)}>{t('다음 달 보기','Next month')}</button></div><div className="labor-calendars">{[offset,offset+1].map(n=>{
  const date=new Date(Date.UTC(year,month-1+n,1)),y=date.getUTCFullYear(),m=date.getUTCMonth(),leading=date.getUTCDay(),days=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  return <section className="card" key={n}><h3>{y} · {m+1}{t('월','')}</h3><div className="calendar-header">{(locale==='ko'?['일','월','화','수','목','금','토']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']).map(day=><span className="weeklabel" key={day}>{day}</span>)}</div><div className="calendar">{Array.from({length:Math.ceil((leading+days)/7)*7},(_,i)=>{
   const d=i-leading+1,valid=d>0&&d<=days,key=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,ds=demands.filter(x=>x.date===key),needed=ds.reduce((sum,x)=>sum+x.count,0),attending=ds.reduce((sum,x)=>sum+confirmedAttendanceCount(jobs.find(j=>j.missionId===x.id&&j.status!=='STALE')),0);
   return <button key={i} className={`day ${valid?'':'empty'} ${key===today?'today':''} ${needed>attending?'labor-shortage':needed?'labor-filled':''}`} disabled={!valid||!needed} aria-label={`${key} ${t('필요인력','Needed')} ${needed} ${t('참석인력','Attending')} ${attending}`} onClick={()=>onDay(key)}>{valid&&<><strong>{d}</strong>{needed>0&&<span className="labor-day-counts"><span>{t('필요','Need')} <b>{needed}</b></span><span>{t('참석','Yes')} <b>{attending}</b></span></span>}</>}</button>
  })}</div></section>;
 })}</div></section>;
}
