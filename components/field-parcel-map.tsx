'use client';
import {addressText} from '@/lib/display-language';
import {cropEnglishName} from '@/lib/crop-registry';
import {useEffect,useRef,useState} from 'react';
import {loadParcelBoundaries} from '@/lib/parcel-boundary-loader';
import GyebukMap from './gyebuk-map';
import {useLanguage} from './language';
import type {Field} from '@/lib/types';
export default function FieldParcelMap({fields}:{fields:Field[]}){
 const {locale}=useLanguage(),ko=locale==='ko';const [features,setFeatures]=useState<any[]>([]),[failed,setFailed]=useState(0),[loading,setLoading]=useState(false);
 const [location,setLocation]=useState<{point?:[number,number];township:string;boundary?:unknown}|null>(null),[locationError,setLocationError]=useState(false);
 const boundaryCache=useRef(new Map<string,unknown>());
 useEffect(()=>{const abort=new AbortController();void fetch('/api/center-settings',{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json(),p=d.settings?.location;setLocation({township:d.center.township,boundary:d.geography?.geometry,point:p?[p.longitude,p.latitude]:d.center.id==='demo'&& !Object.hasOwn(d.settings,'location')?[127.614622222222,35.7825083333333]:undefined})}).catch(()=>{if(!abort.signal.aborted)setLocationError(true)});return()=>abort.abort()},[]);
 const ids=fields.map(f=>f.id+f.crop).join(',');
 useEffect(()=>{const abort=new AbortController();setLoading(true);setFailed(0);
 void(async()=>{
  const result=await loadParcelBoundaries(fields.filter(f=>/^\d{19}$/.test(f.id)).map(f=>f.id),async id=>{
   if(boundaryCache.current.has(id))return boundaryCache.current.get(id);
   const r=await fetch('/api/parcels?pnu='+id,{signal:abort.signal}),d=await r.json();if(!r.ok||d.status!=='READY')throw Error();
   if(!abort.signal.aborted)boundaryCache.current.set(id,d.geometry);return d.geometry;
  },abort.signal);
  if(abort.signal.aborted)return;
  setFeatures(result.items.map(({id,value})=>{const f=fields.find(f=>f.id===id)!;return {geometry:value,label:addressText(f.address.match(/\S+(?:리|동)\s+.+$/)?.[0]??f.address,ko?'ko':'en')+' · '+(ko?f.crop:cropEnglishName(f.crop??'')),color:(({쌀:'#b8e291',감자:'#efd09e',고추:'#efa5a5'} as Record<string,string>)[f.crop??'']??'#b8e291')}}));
  setFailed(result.failed.length);setLoading(false);
 })();return()=>abort.abort();
 },[ids,ko]);
 return <div><GyebukMap features={features} boundary={location?.boundary} centerPoint={location?.point} national={!location?.point} label={location?.township} cadastral/>{!location?.point&&!features.length&&<p role="status">{ko?(locationError?'센터 위치를 불러오지 못해 전국 지도를 표시합니다.':'센터 위치 미설정 · 설정에서 지도 중심을 확인하세요.'):'Center location unavailable. Showing the national map.'}</p>}{loading&&<p role="status">{ko?'관리 농지 경계를 불러오는 중입니다.':'Loading managed parcel boundaries.'}</p>}{failed>0&&<p role="status">{ko?'경계 미수신 '+failed+'필지 · 농지 목록은 유지됩니다.':failed+' boundaries unavailable; fields remain in the list.'}</p>}</div>;
}
