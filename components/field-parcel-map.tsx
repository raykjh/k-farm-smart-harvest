'use client';
import {cropEnglishName} from '@/lib/crop-registry';
import {useEffect,useState} from 'react';
import GyebukMap from './gyebuk-map';
import {useLanguage} from './language';
import type {Field} from '@/lib/types';
export default function FieldParcelMap({fields}:{fields:Field[]}){
 const {locale}=useLanguage(),ko=locale==='ko';const [features,setFeatures]=useState<any[]>([]),[failed,setFailed]=useState(0),[loading,setLoading]=useState(false);
 const [location,setLocation]=useState<{point?:[number,number];township:string;boundary?:unknown}|null>(null),[locationError,setLocationError]=useState(false);
 useEffect(()=>{const abort=new AbortController();void fetch('/api/center-settings',{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json(),p=d.settings?.location;setLocation({township:d.center.township,boundary:d.geography?.geometry,point:p?[p.longitude,p.latitude]:d.center.id==='demo'&& !Object.hasOwn(d.settings,'location')?[127.614622222222,35.7825083333333]:undefined})}).catch(()=>{if(!abort.signal.aborted)setLocationError(true)});return()=>abort.abort()},[]);
 const ids=fields.map(f=>f.id+f.crop).join(',');
 useEffect(()=>{let cancelled=false;setLoading(true);setFeatures([]);setFailed(0);
 void(async()=>{const result:any[]=[];let misses=0;for(const f of fields){if(!/^\d{19}$/.test(f.id))continue;try{const r=await fetch('/api/parcels?pnu='+f.id);const d=await r.json();if(!r.ok||d.status!=='READY')throw Error();result.push({geometry:d.geometry,label:f.address.split('농소리 ').at(-1)+' · '+(ko?f.crop:cropEnglishName(f.crop??'')),color:(({쌀:'#b8e291',감자:'#efd09e',고추:'#efa5a5'} as Record<string,string>)[f.crop??'']??'#b8e291')})}catch{misses++}if(cancelled)return;}if(!cancelled){setFeatures(result);setFailed(misses);setLoading(false)}})();return()=>{cancelled=true};
 },[ids,ko]);
 return <div><GyebukMap features={features} boundary={location?.boundary} centerPoint={location?.point} national={!location?.point} label={location?.township} cadastral/>{!location?.point&&!features.length&&<p role="status">{ko?(locationError?'센터 위치를 불러오지 못해 전국 지도를 표시합니다.':'센터 위치 미설정 · 설정에서 지도 중심을 확인하세요.'):'Center location unavailable. Showing the national map.'}</p>}{loading&&<p role="status">{ko?'관리 농지 경계를 불러오는 중입니다.':'Loading managed parcel boundaries.'}</p>}{failed>0&&<p role="status">{ko?'경계 미수신 '+failed+'필지 · 농지 목록은 유지됩니다.':failed+' boundaries unavailable; fields remain in the list.'}</p>}</div>;
}
