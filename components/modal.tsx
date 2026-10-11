'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useLanguage} from './language';
export default function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),{locale}=useLanguage();
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,el=ref.current;
  if(!el)return;
  let frame=0;
  const place=()=>{
   const content=document.querySelector('.shell > .content'),topbar=content?.querySelector('.topbar');
   if(!content)return;
   const margin=12,left=Math.max(0,content.getBoundingClientRect().left),top=Math.max(0,topbar?.getBoundingClientRect().bottom??0,document.querySelector('.account-bar')?.getBoundingClientRect().bottom??0);
   const width=Math.min(1000,window.innerWidth-left-2*margin),height=window.innerHeight-top-2*margin;
   // Leave the center header and navigation visible; only the work pane is covered.
   if(width>0&&height>120){el.style.position='fixed';el.style.margin='0';el.style.left=`${left+(window.innerWidth-left-width)/2}px`;el.style.top=`${top+margin}px`;el.style.width=`${width}px`;el.style.maxHeight=`${height}px`;el.dataset.workspace='true'}
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(place)};
  el.showModal();place();
  const observer=new ResizeObserver(schedule);
  for(const selector of ['.topbar','.account-bar','.sidebar']){const target=document.querySelector(selector);if(target)observer.observe(target)}
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);el.close();previous?.focus()};
 },[]);
 return createPortal(<dialog ref={ref} className="work-modal" onCancel={e=>{e.preventDefault();onClose()}} aria-label={title}><header className="card-head"><h2>{title}</h2><button type="button" onClick={onClose} aria-label={locale==='ko'?'닫기':'Close'}>✕</button></header>{children}</dialog>,document.body);
}
