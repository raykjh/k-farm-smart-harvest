'use client';
import {useState} from 'react';
import type {GuidelineContext} from '@/lib/crop-guidelines';
import type {SupportedCropCode} from '@/lib/crop-registry';
import {WORKLOAD_CATALOG_VERSION,workloadCrop} from '@/lib/crop-workload-catalog';
import {useLanguage} from './language';
export default function CatalogContextEditor({crop,value,onChange}:{crop:SupportedCropCode;value:GuidelineContext;onChange:(v:GuidelineContext)=>void}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [year,setYear]=useState(value.catalog?.year??new Date().getFullYear()+1);
 const profile=workloadCrop(crop);
 return <details open><summary>{t('작물 작업기간 기준','Crop work-window criteria')}</summary>
 <p>{t('추가 작물의 기간·능률은 교체 가능한 입력자료입니다. 확인된 지역 적합성·장비 호환성 없이는 배차하지 않습니다. 수확량·약제 사용량은 생성하지 않습니다.','Additional crop periods and rates are replaceable inputs. Reviewed field suitability and equipment compatibility are required. No yields or chemical doses are generated.')}</p>
 <div className="registration-grid"><label>{t('적용 지역','Region')}<input value={value.region??''} onChange={e=>onChange({...value,region:e.target.value})}/></label><label>{t('작기 시작 연도','Season starting year')}<input type="number" min="2020" max="2100" value={year} onChange={e=>setYear(Number(e.target.value))}/></label></div>
 <button type="button" onClick={()=>{if(value.operations&&Object.keys(value.operations).length&&!confirm(t('입력한 작업기간을 초기화하고 선택 연도의 공통 기준을 적용할까요?','Replace edited work windows with the common profile for the selected year?')))return;onChange({...value,catalog:{version:WORKLOAD_CATALOG_VERSION,year,dataOrigin:'DEMO',sourceBatchId:value.catalog?.sourceBatchId??'crop30-local-input'},operations:undefined,regionalProfile:undefined,anchors:undefined})}}>{t('공통 작업 기준 적용','Apply common work profile')}</button>
 {value.catalog&&<><p>{value.catalog.year} · {profile.practice}</p><div className="table-wrap"><table><thead><tr><th>{t('작업','Work')}</th><th>{t('작업 가능 기간','Allowed period')}</th><th>{t('장비 / 인원','Equipment / crew')}</th></tr></thead><tbody>{profile.operations.flatMap(op=>op.windows.map((w,i)=>{
  const year=value.catalog!.year+(w.yearOffset??0),configured=value.operations?.[crop]?.[op.code],round=configured?.occurrences?.[i];
  const from=round?.from??(i===0?configured?.from:undefined)??`${year}-${w.from}`,to=round?.to??(i===0?configured?.to:undefined)??`${year}-${w.to}`;
  const change=(key:'from'|'to',date:string)=>{const occurrences=op.windows.map((win,j)=>({occurrence:j+1,from:configured?.occurrences?.[j]?.from??(j===0?configured?.from:undefined)??`${value.catalog!.year+(win.yearOffset??0)}-${win.from}`,to:configured?.occurrences?.[j]?.to??(j===0?configured?.to:undefined)??`${value.catalog!.year+(win.yearOffset??0)}-${win.to}`}));occurrences[i][key]=date;onChange({...value,operations:{...value.operations,[crop]:{...value.operations?.[crop],[op.code]:{occurrences}}}})};
  const method=op.methods[0];return <tr key={op.code+i}><td>{op.name}{op.windows.length>1?` · ${i+1}`:''}</td><td><input aria-label={`${op.code} ${i+1} from`} type="date" value={from} onChange={e=>change('from',e.target.value)}/><input aria-label={`${op.code} ${i+1} to`} type="date" value={to} onChange={e=>change('to',e.target.value)}/></td><td>{method.capability??t('인력','Manual')} / {method.operators+method.workers}{t('명',' people')}</td></tr>;
 }))}</tbody></table></div></>}
 </details>;
}
