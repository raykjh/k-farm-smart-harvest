'use client';
import {useEffect,useState} from 'react';
import type {WorkArea} from '@/lib/equipment-mission';
import type {SplitWorkArea} from '@/lib/split-work-area';
import type {WorkGeometry} from '@/lib/work-area-geometry';
import {Button} from './ui/button';
import {useLanguage} from './language';

export type SplitAreaGroup={groupId:string;fieldId?:string;label?:string;editable:boolean;ready:boolean;reason:string;reviewFingerprint?:string|null;parent?:WorkArea|null;saved?:SplitWorkArea|null;metrics?:{totalAreaM2:number;plannedAreaM2:number};members:{id:string;part:number;label:string;date?:string;status:string;frozen?:boolean;areaHa:number}[]};
const colors=['#21875a','#517ac2','#c17621','#a05597','#498991','#ab5252'];
const rings=(g:WorkGeometry)=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
function Preview({parent,parts}:{parent:WorkGeometry;parts:(WorkGeometry|null)[]}){
 const {locale}=useLanguage(),points=rings(parent).flat(2),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),xmin=Math.min(...xs),ymin=Math.min(...ys),xmax=Math.max(...xs),ymax=Math.max(...ys),cos=Math.cos((ymax+ymin)/2*Math.PI/180),scale=Math.min(580/((xmax-xmin)*cos||1),260/(ymax-ymin||1));
 const offsetX=(620-(xmax-xmin)*cos*scale)/2,offsetY=(300-(ymax-ymin)*scale)/2;
 const path=(g:WorkGeometry)=>rings(g).flat().map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${(x-xmin)*cos*scale+offsetX},${300-offsetY-(y-ymin)*scale}`).join(' ')+'Z').join(' ');
 return <svg role="img" aria-label={locale==='ko'?'분할 작업구역 미리보기':'Split work area preview'} viewBox="0 0 620 300" style={{width:'100%',maxHeight:300,background:'#f5f8f3',border:'1px solid #cbd5c6',borderRadius:6}}><path d={path(parent)} fill="#e0e6db" fillRule="evenodd" stroke="#354938" strokeWidth={2}/>{parts.map((p,i)=>p&&<path key={i} d={path(p)} fill={colors[i%colors.length]} fillOpacity={0.5} fillRule="evenodd" stroke={colors[i%colors.length]} strokeWidth={1.5}/>)}</svg>;
}
export function SplitWorkAreaEditor({group,canManage,save}:{group:SplitAreaGroup;canManage:boolean;save:(body:object)=>Promise<boolean>}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [geometries,setGeometries]=useState<Record<string,string>>({}),[reviewedOn,setReviewedOn]=useState(''),[note,setNote]=useState(''),[ack,setAck]=useState(false),[axis,setAxis]=useState<'EW'|'NS'>('EW'),[source,setSource]=useState<'OPERATOR_DRAWN'|'FIELD_SURVEY'>('OPERATOR_DRAWN'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setGeometries(Object.fromEntries(group.saved?.parts.map(p=>[p.missionId,JSON.stringify(p.geometry)])??[]));setReviewedOn(group.saved?.reviewedOn??'');setNote(group.saved?.note??'');setSource(group.saved?.source??'OPERATOR_DRAWN');setAck(false);setError('');},[group.groupId,group.reviewFingerprint,group.saved?.version]);
 const parsed=group.members.map(m=>{try{const g=JSON.parse(geometries[m.id]??'');const ps=rings(g);if(!ps.length||!ps.flat(2).every((p:unknown)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))return null;return g as WorkGeometry;}catch{return null;}});
 const enabled=canManage&&group.editable&&!!group.parent?.machineAccessConfirmed;
 async function draft(){setBusy(true);setError('');setAck(false);try{
  const r=await fetch('/api/equipment-missions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'splitDraft',groupId:group.groupId,fingerprint:group.reviewFingerprint,axis})}),d=await r.json();if(!r.ok)throw Error(d.error);
  setGeometries(Object.fromEntries(d.parts.map((p:{missionId:string;geometry:WorkGeometry})=>[p.missionId,JSON.stringify(p.geometry)])));setSource('OPERATOR_DRAWN');
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false)}}
 return <details className="split-area-review" data-testid={'split-area-'+group.groupId}><summary>{t('회차별 현장 구역','Field areas by work part')} · {group.label??group.groupId} · {group.members.length}{t('회',' parts')}</summary>
  <p>{group.ready?t('구역 연결 완료 · 겹침·누락·작업량 비율 확인됨','Areas linked · overlap, coverage and workload ratios checked'):t(group.reason,'Area review required. Review the complete field and all parts.')}</p>
  {group.ready&&group.metrics&&<p>{t('확인된 전체 경계 근사면적','Reviewed approximate footprint')} {Math.round(group.metrics.totalAreaM2).toLocaleString()} m² · {t('계획 작업면적','Planned work area')} {Math.round(group.metrics.plannedAreaM2).toLocaleString()} m²</p>}
  {!group.editable&&<p>{t('시작·완료·취소·잠금 회차가 포함되어 구역을 수정할 수 없습니다.','The group contains started, closed or locked work. Its areas cannot be edited.')}</p>}
  {group.members.some(m=>m.frozen)&&group.editable&&<p>{t('완료 회차의 기록과 확인 구역은 고정됩니다. 남은 구역만 다시 나눕니다.','Completed records and reviewed areas stay fixed. Only remaining areas are repartitioned.')}</p>}
  {group.parent&&<><Preview parent={group.parent.geometry} parts={parsed}/><p className="muted">{t('북쪽이 위입니다. 현장 작업구역 기준 도면이며 지적도·자율주행 경로가 아닙니다.','North is up. This is an operational-area drawing, not a cadastral map or an autonomous driving route.')}</p></>}
  {error&&<p role="alert">{error}</p>}
  <form onSubmit={async e=>{e.preventDefault();if(parsed.some(p=>!p)){setError(t('모든 회차에 올바른 경계를 입력하세요.','Enter valid geometry for every part.'));return;}setBusy(true);try{if(await save({action:'splitArea',version:group.saved?.version??0,fingerprint:group.reviewFingerprint,area:{groupId:group.groupId,source,reviewedOn,note,accessAndExclusionsReviewed:ack,parts:group.members.map((m,i)=>({missionId:m.id,geometry:parsed[i]}))}}))setAck(false);}finally{setBusy(false);}}}>
   <fieldset disabled={!enabled||busy}>
    <div className="actions"><label>{t('초안 분할 방향','Draft direction')}<select value={axis} onChange={e=>setAxis(e.target.value as 'EW'|'NS')}><option value="EW">{t('서쪽 → 동쪽','West → east')}</option><option value="NS">{t('남쪽 → 북쪽','South → north')}</option></select></label><Button type="button" variant="outline" onClick={()=>void draft()}>{t('면적 비율로 구역 초안','Draft areas by workload')}</Button></div>
    <p>{t('초안은 저장·확정되지 않습니다. 진입·회차·경사·위험구역을 현장에서 확인하고 필요하면 아래 경계를 수정하세요. 전체 면적 차이 5%, 회차별 비율 차이 0.5%p를 넘으면 작업량·배차를 다시 검토합니다. 이는 임시 데이터 정합 기준이며 현장 안전 기준이 아닙니다.','Drafting does not save or approve areas. Review access, turning space, slopes and hazards on site. Differences above 5% in total area or 0.5 percentage points in part shares require planning review. These are provisional data checks, not field safety standards.')}</p>
    {group.members.map((m,i)=><section key={m.id} className="split-area-part"><h4><span style={{color:colors[i%colors.length]}}>■</span> {t('회차','Part')} {m.part} · {m.date??'—'} · {Math.round(m.areaHa*10000).toLocaleString()} m² ({(m.areaHa/group.members.reduce((n,r)=>n+r.areaHa,0)*100).toFixed(1)}%) {m.frozen&&t('· 완료 구역 고정','· Completed area fixed')}</h4><details><summary>{t('현장 경계 입력·수정 (GeoJSON)','Enter / edit surveyed boundary (GeoJSON)')}</summary><label>{t('회차','Part')} {m.part} · GeoJSON<textarea rows={4} readOnly={m.frozen} aria-label={`${t('회차','Part')} ${m.part} GeoJSON`} value={geometries[m.id]??''} onChange={e=>{setGeometries({...geometries,[m.id]:e.target.value});setAck(false)}}/></label></details></section>)}
    <div className="registration-grid"><label>{t('분할 구역 출처','Partition source')}<select value={source} onChange={e=>{setSource(e.target.value as typeof source);setAck(false)}}><option value="OPERATOR_DRAWN">{t('담당자 현장 도면','Operator field drawing')}</option><option value="FIELD_SURVEY">{t('현장 측량','Field survey')}</option></select></label><label>{t('분할 현장 확인일','Partition review date')}<input type="date" required value={reviewedOn} onChange={e=>{setReviewedOn(e.target.value);setAck(false)}}/></label><label>{t('분할 확인 근거','Partition review evidence')}<input required minLength={3} maxLength={1000} value={note} onChange={e=>{setNote(e.target.value);setAck(false)}}/></label><label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{t('모든 회차의 진입·제외구역·작업량 비율을 현장 확인했습니다.','I reviewed access, exclusions and workload ratios for every part on site.')}</label></div>
    <Button type="submit" disabled={!ack||parsed.some(p=>!p)}>{t('분할 구역 일괄 확인·저장','Review and save all part areas')}</Button>
   </fieldset>
  </form>
  {group.saved&&<p className="muted">{t('저장 버전','Saved version')} {group.saved.version} · {t('전체 구역 버전','Parent area version')} {group.saved.parentVersion} · {group.saved.reviewedOn} · {group.saved.reviewedBy.replace(/ \[[^\]]+\]$/,'')}</p>}
 </details>;
}
