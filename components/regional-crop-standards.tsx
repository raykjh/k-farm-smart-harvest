'use client';
import {useEffect,useState} from 'react';
import {cropCatalog} from '@/lib/crop-catalog';
import {regionalStandardSchema,type RegionalStandard,type SavedRegionalStandard} from '@/lib/regional-crop-standard';
import {useLanguage,LanguageSelector} from './language';
import EnvironmentRuleEditor from './environment-rule-editor';
import {catalogForCrop} from '@/lib/operating-information';
import {cropCodes,type SupportedCropCode} from '@/lib/crop-registry';
import styles from './regional-crop-standards.module.css';
const blank=():RegionalStandard=>({catalogProfileId:cropCatalog[0].id,scope:'COMMON',region:'',practice:'',variety:'',status:'DRAFT',reviewer:'',orchardStage:null,yieldLowKgPer1000m2:null,yieldHighKgPer1000m2:null,sourceUrls:[],notes:'',operations:[]});
export default function RegionalCropStandards(){
 const {locale}=useLanguage(),ko=locale==='ko',t=(a:string,b:string)=>ko?a:b;
 const [items,setItems]=useState<SavedRegionalStandard[]>([]),[profile,setProfile]=useState(blank),[id,setId]=useState(''),[version,setVersion]=useState(0),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[message,setMessage]=useState(''),[filter,setFilter]=useState(''),[sources,setSources]=useState('');
 const set=<K extends keyof RegionalStandard>(key:K,value:RegionalStandard[K])=>{setProfile(p=>({...p,...(key==='status'||key==='reviewer'?{}:{status:'DRAFT' as const,reviewer:''}),[key]:value}));setDirty(true);};
 async function refresh(){try{const r=await fetch('/api/regional-crop-standards',{cache:'no-store'}),b=await r.json();if(!r.ok)throw Error(b.error);setItems(b.items);}catch(e){setMessage(String(e));}}
 useEffect(()=>{void refresh();},[]);
 useEffect(()=>{const crop=new URLSearchParams(location.search).get('crop');if(!crop||!(cropCodes as readonly string[]).includes(crop))return;const catalog=catalogForCrop(crop as SupportedCropCode);if(catalog)setProfile(p=>({...p,catalogProfileId:catalog.id,orchardStage:catalog.category==='ORCHARD'?'BEARING':null}))},[]);
 useEffect(()=>{const leave=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty]);
 function open(row?:SavedRegionalStandard){if(dirty&&!confirm(t('저장하지 않은 변경을 버릴까요?','Discard unsaved changes?')))return;setProfile(row?.profile??blank());setSources(row?.profile.sourceUrls.join('\n')??'');setId(row?.id??crypto.randomUUID());setVersion(row?.version??0);setDirty(false);setMessage('');}
 async function save(){
  const parsed=regionalStandardSchema.safeParse({...profile,sourceUrls:sources.split('\n').map(s=>s.trim()).filter(Boolean)});
  if(!parsed.success){setMessage(parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('\n'));return;}
  setBusy(true);setMessage('');const recordId=id||crypto.randomUUID();setId(recordId);
  try{const r=await fetch('/api/regional-crop-standards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:recordId,expectedVersion:version,profile:parsed.data})}),b=await r.json();if(!r.ok)throw Error(b.error);setProfile(b.item.profile);setVersion(b.item.version);setDirty(false);await refresh();setMessage(t('저장했습니다. 기존 일정은 변경하지 않았습니다.','Saved. Existing schedules are unchanged.'));}catch(e){setMessage(String(e));}finally{setBusy(false);}
 }
 const num=(v:string)=>v===''?null:Number(v),crop=cropCatalog.find(c=>c.id===profile.catalogProfileId);
 function opSet(index:number,patch:Partial<RegionalStandard['operations'][number]>){set('operations',profile.operations.map((o,i)=>i===index?{...o,...patch}:o));}
 return <section className={`${styles.editor} card section-space`}><div className="card-head"><a href="/references">← {t('작물 기준자료','Crop references')}</a><LanguageSelector/></div><h1>{t('작물 환경 기준·지역 보정','Crop conditions and regional overrides')}</h1>
 <p>{t('지역·작형별 작업 기준을 저장합니다. 검토 완료도 자동 배차 허가가 아니며, 이 화면은 기존 계획을 변경하지 않습니다.','Save regional work standards. Reviewed does not mean scheduling approval; existing plans are unchanged.')}</p>
 <p>{t('모르는 수확량·기온은 비워두세요. 시간은 1,000㎡당 분, 수확량은 1,000㎡당 kg입니다.','Leave unknown yield and temperature blank. Duration: minutes per 1,000 m². Yield: kg per 1,000 m².')}</p>
 <button type="button" onClick={()=>open()} disabled={busy}>{t('새 기준 작성','New standard')}</button> <button type="button" onClick={refresh} disabled={busy}>{t('목록 새로고침','Refresh list')}</button>
 <label>{t('저장된 기준 검색','Search saved standards')} <input value={filter} onChange={e=>setFilter(e.target.value)}/></label>
 <ul>{items.filter(i=>`${i.profile.region} ${i.profile.practice} ${cropCatalog.find(c=>c.id===i.profile.catalogProfileId)?.name}`.includes(filter)).map(i=><li key={i.id}><button type="button" disabled={busy} onClick={()=>open(i)}>{i.profile.region} · {cropCatalog.find(c=>c.id===i.profile.catalogProfileId)?.name} · {i.profile.practice} · v{i.version} · {i.profile.status==='DRAFT'?t('초안','Draft'):t('검토 완료','Reviewed')}</button></li>)}</ul>
 <form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy} style={{border:0,padding:0}}>
 <h2>{t('기준 편집','Edit standard')} {version>0&&`v${version}`} {dirty&&'*'}</h2>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16}}>
 <label>{t('작물·작형','Catalog crop')}<select value={profile.catalogProfileId} onChange={e=>{const c=cropCatalog.find(c=>c.id===e.target.value)!;setProfile(p=>({...p,catalogProfileId:c.id,orchardStage:c.category==='ORCHARD'?'BEARING':null,status:'DRAFT',reviewer:''}));setDirty(true);}}>{cropCatalog.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>{t('적용 범위','Scope')}<select value={profile.scope??'REGIONAL_OVERRIDE'} onChange={e=>set('scope',e.target.value as RegionalStandard['scope'])}><option value="COMMON">{t('작물 공통 환경 기준','Common crop conditions')}</option><option value="REGIONAL_OVERRIDE">{t('지역·품종 보정','Regional / variety override')}</option></select></label>
 {profile.scope!=='COMMON'&&<label>{t('대상 지역','Region')}<input required value={profile.region} onChange={e=>set('region',e.target.value)} placeholder={t('전북특별자치도 장수군 계북면','Region name')}/></label>}
 <label>{t('재배 방식·작형','Cultivation practice')}<input required value={profile.practice} onChange={e=>set('practice',e.target.value)}/></label>
 <label>{t('품종 (선택)','Variety (optional)')}<input value={profile.variety} onChange={e=>set('variety',e.target.value)}/></label>
 {crop?.category==='ORCHARD'&&<label>{t('과수 단계','Orchard stage')}<select value={profile.orchardStage??''} onChange={e=>set('orchardStage',e.target.value as RegionalStandard['orchardStage'])}><option value="">{t('선택','Select')}</option><option value="ESTABLISHMENT">{t('과원 조성','Establishment')}</option><option value="IMMATURE">{t('미성목','Immature')}</option><option value="BEARING">{t('성목','Bearing')}</option></select></label>}
 <label>{t('수확량 하한 (kg/1,000㎡)','Yield low (kg/1,000 m²)')}<input type="number" min="0" step="any" value={profile.yieldLowKgPer1000m2??''} onChange={e=>set('yieldLowKgPer1000m2',num(e.target.value))}/></label>
 <label>{t('수확량 상한 (kg/1,000㎡)','Yield high (kg/1,000 m²)')}<input type="number" min="0" step="any" value={profile.yieldHighKgPer1000m2??''} onChange={e=>set('yieldHighKgPer1000m2',num(e.target.value))}/></label>
 <label>{t('검토 상태','Review status')}<select value={profile.status} onChange={e=>set('status',e.target.value as RegionalStandard['status'])}><option value="DRAFT">{t('초안','Draft')}</option><option value="REVIEWED">{t('검토 완료 (배차 미적용)','Reviewed (not activated)')}</option></select></label>
 <label>{t('검토자','Reviewer')}<input value={profile.reviewer} onChange={e=>set('reviewer',e.target.value)}/></label></div>
 <label>{t('근거 출처 URL (한 줄에 하나)','Source URLs (one per line)')}<textarea rows={3} style={{width:'100%'}} value={sources} onChange={e=>{setSources(e.target.value);set('sourceUrls',[]);}}/></label>
 <label>{t('검토 메모·적용 한계','Review notes and limitations')}<textarea rows={3} style={{width:'100%'}} value={profile.notes} onChange={e=>set('notes',e.target.value)}/></label>
 <h2>{t('작업 기준','Work standards')}</h2>
 {profile.operations.map((o,i)=><fieldset key={i} style={{marginBottom:16,padding:16}}><legend>{i+1}. {o.name||t('새 작업','New operation')}</legend><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
 <label>{t('작업 코드','Operation code')}<input required value={o.code} onChange={e=>opSet(i,{code:e.target.value})}/></label><label>{t('작업명','Operation name')}<input required value={o.name} onChange={e=>opSet(i,{name:e.target.value})}/></label>
 <label>{t('일정 산출 방식','Timing method')}<select value={o.timingMode??'CALENDAR_OVERRIDE'} onChange={e=>opSet(i,{timingMode:e.target.value as typeof o.timingMode})}><option value="ENVIRONMENT">{t('환경 조건으로 계산','Environmental conditions')}</option><option value="CALENDAR_OVERRIDE">{t('날짜 직접 보정','Calendar override')}</option></select></label>
 {o.timingMode==='ENVIRONMENT'?<EnvironmentRuleEditor value={o.environment??{metric:'meanTemperatureC',lowerC:null,upperC:null,consecutiveDays:1,minimumNightC:null}} onChange={environment=>opSet(i,{environment})}/>:<>
 <label>{t('시작 월-일','From MM-DD')}<input placeholder="05-01" required value={o.from} onChange={e=>opSet(i,{from:e.target.value})}/></label><label>{t('마지막 월-일','Until MM-DD')}<input placeholder="05-31" required value={o.to} onChange={e=>opSet(i,{to:e.target.value})}/></label>
 <label><input type="checkbox" checked={o.crossYear} onChange={e=>opSet(i,{crossYear:e.target.checked})}/>{t('다음 해까지','Crosses year')}</label>
 <label>{t('기온 하한 (℃)','Temperature low (°C)')}<input type="number" step="any" value={o.minTemperatureC??''} onChange={e=>opSet(i,{minTemperatureC:num(e.target.value)})}/></label><label>{t('기온 상한 (℃)','Temperature high (°C)')}<input type="number" step="any" value={o.maxTemperatureC??''} onChange={e=>opSet(i,{maxTemperatureC:num(e.target.value)})}/></label></>}
 <label>{t('수행 방식','Work method')}<select value={o.mode} onChange={e=>opSet(i,{mode:e.target.value as typeof o.mode})}><option value="MANUAL">{t('인력','Manual')}</option><option value="MACHINE_WITH_OPERATOR">{t('장비 + 운영자','Machine + operator')}</option><option value="AUTOMATED_WITH_OPERATOR">{t('자동화 장비 + 운영자','Automated + operator')}</option></select></label>
 <label>{t('필요 장비 기능','Equipment capability')}<input value={o.capability} onChange={e=>opSet(i,{capability:e.target.value})}/></label>
 <label>{t('일반 인력 (명)','Workers')}<input type="number" min="0" value={o.workers} onChange={e=>opSet(i,{workers:Number(e.target.value)})}/></label><label>{t('장비 운영자 (명)','Operators')}<input type="number" min="0" value={o.operators} onChange={e=>opSet(i,{operators:Number(e.target.value)})}/></label>
 <label>{t('소요시간 (분/1,000㎡)','Duration (min/1,000 m²)')}<input type="number" step="any" min="0.01" value={o.minutesPer1000m2||''} onChange={e=>opSet(i,{minutesPer1000m2:Number(e.target.value)})}/></label>
 <label>{t('작업 근거 URL','Operation source URL')}<input type="url" required value={o.sourceUrl} onChange={e=>opSet(i,{sourceUrl:e.target.value})}/></label></div>
 <label>{t('기간·기온 판단 근거 (평균/최저기온 등)','Window / temperature basis (mean, minimum, etc.)')}<textarea required style={{width:'100%'}} value={o.basis} onChange={e=>opSet(i,{basis:e.target.value})}/></label><button type="button" onClick={()=>set('operations',profile.operations.filter((_,n)=>n!==i))}>{t('이 작업 삭제','Remove operation')}</button></fieldset>)}
 <button type="button" onClick={()=>set('operations',[...profile.operations,{code:'',name:'',timingMode:'ENVIRONMENT',environment:null,from:'',to:'',crossYear:false,minTemperatureC:null,maxTemperatureC:null,basis:'',mode:'MANUAL',capability:'',workers:1,operators:0,minutesPer1000m2:0,sourceUrl:''}])}>{t('작업 추가','Add operation')}</button> <button type="submit">{busy?t('저장 중…','Saving…'):t('기준 저장','Save standard')}</button>
 </fieldset></form><p role="status" style={{whiteSpace:'pre-wrap'}}>{message}</p></section>;
}
