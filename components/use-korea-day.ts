'use client';
import {useEffect,useState} from 'react';
export function koreaDay(now=new Date()){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10)}
export function useKoreaDay(){
 const [day,setDay]=useState(()=>koreaDay());
 useEffect(()=>{const update=()=>setDay(koreaDay());const timer=setInterval(update,1000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update)}},[]);
 return day;
}
