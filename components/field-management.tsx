'use client';
import {addressText} from '@/lib/display-language';
import {operationalText} from '@/lib/operational-i18n';
import {useEffect,useState} from 'react';
import type {Field} from '@/lib/types';
import type {FieldEntry} from '@/lib/field-record';
import type {Consultation} from '@/lib/consultation';
import {useLanguage} from './language';
import FieldAccessInput from './field-access-input';
import FieldWorkHistory from './field-work-history';
import CultivationPanel from './cultivation-panel';
import FieldConditionsInput from './field-conditions-input';
import ContinuousProductionPanel from './continuous-production-panel';

type Tab='owner'|'field'|'crop'|'history';
export default function FieldManagement({field,onSaved}:{field:Field;onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [tab,setTab]=useState<Tab>('owner'),[visited,setVisited]=useState<Tab[]>(['owner']);
 const [historyVersion,setHistoryVersion]=useState(0);
 async function saved(){await onSaved();setHistoryVersion(v=>v+1);}
 const [entry,setEntry]=useState<FieldEntry|null>(null),[owner,setOwner]=useState<Consultation|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  async function read(){
   setLoading(true);setError('');setOwner(null);setEntry(null);
   try{
    const response=await fetch('/api/fields',{signal:controller.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error);
    const saved=(data.payload as FieldEntry[]).find(f=>f.pnu===field.id)??null;setEntry(saved);
    const id=saved?.consultationId??field.farmerId;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return;
    const result=await fetch('/api/consultations?id='+encodeURIComponent(id),{signal:controller.signal,cache:'no-store'}),body=await result.json();
    if(result.status===404)return;if(!result.ok)throw Error(body.error);
    const consultation=body.payload as Consultation;
    // Do not present an unrelated contact as the owner if a legacy link is wrong.
    if(!consultation.fields.some(f=>f.pnu===field.id))throw Error(t('농지와 소유주 등록자료의 연결을 확인해주세요.','Check the link between this field and its owner record.'));
    setOwner(consultation);
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
   finally{if(!controller.signal.aborted)setLoading(false);}
  }
  void read();return()=>controller.abort();
 },[field.id,field.farmerId,historyVersion]);
 const parcel=owner?.fields.find(f=>f.pnu===field.id),pending=!field.crop||field.serviceStatus==='CROP_REQUIRED';
 const tabs:[Tab,string][]=[['owner',t('소유주','Owner')],['field',t('농지 정보','Field details')],['crop',t('작물·생산','Crop / production')],['history',t('작업 이력','Work history')]];
 const fact=(label:string,value:string|number|undefined|null)=><div key={label}><dt>{label}</dt><dd>{value||t('미등록','Not recorded')}</dd></div>;
 return <div className="field-management" data-testid="field-management">
  <div className="field-management-heading"><h3>{addressText(field.address,locale)}</h3><span>{pending?t('작물 선택 대기','Awaiting crop selection'):operationalText(field.crop,locale)}</span></div>
  <div className="field-management-tabs" role="tablist" aria-label={t('농지 관리','Field management')}>
   {tabs.map(([id,label])=><button key={id} type="button" role="tab" id={'field-tab-'+id} aria-selected={tab===id} aria-controls={'field-panel-'+id} onClick={()=>{setTab(id);setVisited(v=>v.includes(id)?v:[...v,id]);}}>{label}</button>)}
  </div>
  <div className="field-management-body">
   {tabs.map(([id])=><section key={id} id={'field-panel-'+id} role="tabpanel" aria-labelledby={'field-tab-'+id} hidden={tab!==id}>
    {id==='owner'&&<>{loading?<p role="status">{t('소유주 정보를 불러오는 중입니다.','Loading owner details.')}</p>:<>
     {error&&<p role="alert">{error}</p>}
     <dl className="ledger-facts">
      {fact(t('소유주 이름','Owner name'),parcel?.ownerName||(parcel?.tenure==='owned'?owner?.farmer.name:undefined))}
      {fact(t('연락처','Phone'),parcel?.ownerPhone||(parcel?.tenure==='owned'?owner?.farmer.phone:undefined))}
      {fact(t('신청자','Applicant'),owner?.farmer.name??field.name)}
      {fact(t('신청자 생년월일','Applicant birth date'),owner?.farmer.birth)}
      {fact(t('거주 주소','Residence'),owner?.application?.residence)}
      {fact(t('연락 방법','Contact method'),owner?({sms:t('문자','SMS'),phone:t('전화','Phone'),app:t('앱','App')}[owner.farmer.contact]):undefined)}
      {fact(t('소유 관계','Tenure'),parcel?({owned:t('본인 소유','Owner'),lease:t('임대','Leased'),family:t('가족 소유','Family owned'),other:t('기타','Other'),unknown:t('미확인','Unknown')}[parcel.tenure]):undefined)}
      {fact(t('확인 자료','Evidence'),parcel?({none:t('미등록','Not recorded'),ownership:t('소유권 확인자료','Ownership record'),lease:t('임대 계약서','Lease'),free:t('사용 동의','Use consent'),authorization:t('위임장','Authorization'),family:t('가족관계 자료','Family record')}[parcel.evidence]):undefined)}
     </dl>
     {!owner&&!error&&<p>{t('연결된 소유주 상세 등록자료가 없습니다.','No linked owner details are recorded.')}</p>}
    </>}</>}
    {id==='field'&&<><dl className="ledger-facts">
     {fact(t('지번 주소','Parcel address'),addressText(field.address,locale))}{fact(t('필지 번호','Parcel ID'),field.id)}
     {fact(t('작업 면적','Work area'),field.area.toLocaleString()+' m²')}
     {fact(t('토지 형태','Land type'),entry?.conditions?({paddy:t('논','Paddy'),upland:t('밭','Upland'),orchard:t('과수원','Orchard'),unknown:t('미확인','Unknown')}[entry.conditions.landUse]):undefined)}
     {fact(t('관리 지역','Service area'),entry?.conditions?.region)}{fact(t('작물','Crop'),pending?t('작물 선택 대기','Awaiting crop selection'):operationalText(field.crop,locale))}
     <div><dt>{t('장비 진입','Machine access')}</dt><dd><FieldAccessInput field={field} onSaved={saved}/></dd></div>
    </dl><FieldConditionsInput pnu={field.id} onSaved={saved}/></>}
    {id==='crop'&&visited.includes('crop')&&<><CultivationPanel key={historyVersion} fieldId={field.id} onSaved={saved}/><ContinuousProductionPanel fieldId={field.id} revision={historyVersion} active={tab==='crop'} onSaved={saved}/></>}
    {id==='history'&&visited.includes('history')&&<FieldWorkHistory key={historyVersion} fieldId={field.id}/>}
   </section>)}
  </div>
 </div>;
}
