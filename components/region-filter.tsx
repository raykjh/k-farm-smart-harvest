'use client';
import {addressText} from '@/lib/display-language';
import {useEffect,useState} from 'react';
import {useLanguage} from './language';
type Region={code:string;name:string};
export default function RegionFilter({onChange}:{onChange:(code:string)=>void}){
 const {locale}=useLanguage(),ko=locale==='ko';
 const [province,setProvince]=useState(''),[district,setDistrict]=useState(''),[provinces,setProvinces]=useState<Region[]>([]),[districts,setDistricts]=useState<Region[]>([]),[error,setError]=useState(false);
 useEffect(()=>{const controller=new AbortController();setError(false);
  const url=province?'/api/regions?level=district&parent='+province:'/api/regions?level=province';
  fetch(url,{signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok||value.complete===false)throw Error();return value.items as Region[];}).then(items=>{if(!controller.signal.aborted)(province?setDistricts:setProvinces)(items);}).catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>controller.abort();
 },[province]);
 return <><label>{ko?'시·도':'Province'} <select value={province} onChange={e=>{setProvince(e.target.value);setDistrict('');setDistricts([]);onChange(e.target.value);}}><option value="">{ko?'전국':'Nationwide'}</option>{provinces.map(r=><option key={r.code} value={r.code}>{addressText(r.name,locale)}</option>)}</select></label><label>{ko?'시·군·구':'District'} <select disabled={!province} value={district} onChange={e=>{setDistrict(e.target.value);onChange(e.target.value||province);}}><option value="">{ko?'전체':'All'}</option>{districts.map(r=><option key={r.code} value={r.code}>{addressText(r.name,locale)}</option>)}</select></label>{error&&<span role="status">{ko?'지역 목록 수신 실패':'Region list unavailable'}</span>}</>;
}
