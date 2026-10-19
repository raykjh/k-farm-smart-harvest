'use client';
import {operationalText} from '@/lib/operational-i18n';
import {useEffect,useState} from 'react';
import {cropReferences} from '@/lib/crop-reference';
import {cropGuidelines,type CropCode} from '@/lib/crop-guidelines';
import {legacyCatalogProfile} from '@/lib/crop-catalog';
import {operationRequirement} from '@/lib/operation-requirements';
import type {SavedRegionalStandard} from '@/lib/regional-crop-standard';
import {LanguageSelector,useLanguage} from './language';
import CropCatalogPanel from './crop-catalog-panel';
import {environmentSummary} from '@/lib/environment-summary';
import EnvironmentPlanPreview from './environment-plan-preview';
import {cropStageEvidence} from '@/lib/crop-stage-evidence';
export function CropReferenceLink(){const {locale}=useLanguage();return <div style={{padding:'8px 24px',background:'#eef4ed'}}><a href="/references">{locale==='ko'?'작물 기준자료 →':'Crop references →'}</a></div>}
export default function CropReferencePanel({embedded=false}:{embedded?:boolean}){
 const {locale}=useLanguage(),ko=locale==='ko',t=(a:string,b:string)=>ko?a:b;
 const [standards,setStandards]=useState<SavedRegionalStandard[]>([]),[region,setRegion]=useState(''),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/regional-crop-standards',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();setStandards((await r.json()).items);}).catch(()=>setError('지역 기준 조회 실패 / Regional standards unavailable'));},[]);
 const codes:CropCode[]=['rice','potato','pepper'],names=['Rice','Spring potato','Pepper'];
 const equipment:Record<string,string>={RP:t('이앙기 + 운영자','Rice transplanter + operator'),PS:t('감자 파종기 + 운영자','Potato planter + operator'),TR:t('트랙터 + 운영자','Tractor + operator'),CB:t('콤바인 + 운영자','Combine + operator'),PD:t('감자 굴취기 + 운영자','Potato digger + operator')};
 return <div className={embedded?'embedded-panel':'main'}>{!embedded&&<div className="card-head"><a href="/">← K-Farm</a><LanguageSelector/></div>}<h2>{t('작물 기준자료','Crop reference data')}</h2>
 <p className="section-space"><a href="/crop-info">{t('작물정보 목록·상세 보기 →','Crop information directory →')}</a> · <a href="/equipment-info">{t('장비정보 목록·상세 보기 →','Equipment information directory →')}</a></p>
 <div className="card-head"><label>{t('대상 지역','Region')} <select value={region} onChange={e=>setRegion(e.target.value)}><option value="">{t('공통 기준','Common guidelines')}</option>{[...new Set(standards.filter(s=>s.profile.scope!=='COMMON').map(s=>s.profile.region))].sort().map(r=><option key={r}>{r}</option>)}</select></label><a href="/crop-standards">{t('지역별 기준 작성·편집 →','Edit regional standards →')}</a></div>
 {error&&<p role="alert">{error}</p>}<p><a href="/capacity">{t('30작물 작업표·소유자 참여·자원계획 →','30-crop work profiles, participation and resource planning →')}</a></p><EnvironmentPlanPreview/>
 <div className="stack section-space">{cropReferences.map((ref,i)=>{
 const code=codes[i],catalog=legacyCatalogProfile(code)!,evidence=cropStageEvidence.find(e=>e.crop===code)!;
 const regional=standards.filter(s=>s.profile.catalogProfileId===catalog.id&&(s.profile.scope==='COMMON'||s.profile.region===region));
 return <section className="card" key={ref.id}><h2>{ko?ref.crop:names[i]}</h2>
 <details><summary>{t('단계별 환경 근거 · 적용 검토 상태','Stage evidence · application review')}</summary><p>{operationalText(evidence.stage,locale)} · {'target' in evidence?`${evidence.target} ℃`:'low' in evidence?`${evidence.low}–${evidence.high} ℃`:t('수치 적용 보류','Threshold pending')}</p><p>{operationalText(evidence.review,locale)}</p><a href={evidence.sourceUrl} target="_blank" rel="noreferrer">{t('공식 출처 · 지역 실행기준과 구분','Official source · not regional operating approval')}</a></details>
 <p><strong>{t('참고 수확량 범위','Reference yield range')}</strong> {ref.yieldKgPer1000m2.low}–{ref.yieldKgPer1000m2.high} kg / 1,000 m² <small>({t('전국 통계 기준','National statistics')})</small></p>
 {regional.length?regional.map(s=><div key={s.id}><h3>{(s.profile.scope==='COMMON'?t('공통 환경 기준','Common conditions'):s.profile.region)} · {s.profile.practice} {s.profile.variety} · {s.profile.status==='DRAFT'?t('초안','Draft'):t('검토 완료 · 배차 미적용','Reviewed · not activated')} · v{s.version}</h3>
 {s.profile.yieldLowKgPer1000m2!==null&&<p>{t('지역 참고 수확량','Regional reference yield')}: {s.profile.yieldLowKgPer1000m2}–{s.profile.yieldHighKgPer1000m2} kg / 1,000 m²</p>}
 <div className="table-wrap"><table><thead><tr>{[t('기간','Period'),t('작업','Work'),t('기온 조건','Temperature'),t('필요 장비·인력','Equipment / labor'),t('소요시간','Duration')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{s.profile.operations.map(o=><tr key={o.code}><td>{o.timingMode==='ENVIRONMENT'?t('기상자료로 자동 산출','Calculated from weather'):`${o.from} ~ ${o.crossYear?t('다음 해 ','Next year '):''}${o.to}`}</td><td>{operationalText(o.name,locale)}</td><td>{environmentSummary(o,ko)}</td><td>{o.mode==='MANUAL'?t('인력','Manual'):o.capability} · {t('인력','Workers')} {o.workers} · {t('운영자','Operators')} {o.operators}</td><td>{o.minutesPer1000m2} {t('분/1,000㎡','min/1,000 m²')}</td></tr>)}</tbody></table></div>
 {!s.profile.operations.length&&<p>{t('작업 기간 미입력','No work periods entered')}</p>}
 <details><summary>{t('지역 기준 근거','Regional evidence')}</summary><p>{s.profile.notes}</p>{s.profile.operations.map(o=><p key={o.code}>{operationalText(o.name,locale)}: {o.basis} <a href={o.sourceUrl} target="_blank" rel="noreferrer">{t('출처','Source')}</a></p>)}{s.profile.sourceUrls.map(u=><p key={u}><a href={u} target="_blank" rel="noreferrer">{u}</a></p>)}</details></div>):<>
 <p className="description">{region?t('선택 지역의 저장된 기준 없음 · 아래는 공통 작업 순서','No saved regional standard · common sequence below'):t('공통 작업 순서 · 지역별 날짜 확인 필요','Common sequence · local dates require review')}</p>
 <div className="table-wrap"><table><thead><tr>{[t('기간·시점','Period / timing'),t('해야 할 작업','Required work'),t('필요 장비·인력 (계획 기준)','Equipment / labor (provisional)')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{cropGuidelines[code].steps.map(o=>{const req=operationRequirement(code,o.code,'full');return <tr key={o.code}><td>{operationalText(o.timing,locale)}</td><td>{operationalText(o.name,locale)}</td><td>{req.machineCode?equipment[req.machineCode]??req.machineCode:t('인력 · 필요 인원 확인','Manual · staffing to be confirmed')}</td></tr>;})}</tbody></table></div></>}
 <details className="section-space"><summary>{t('출처·통계 기준 보기','Sources and statistical basis')}</summary><p>{t('2021–2025 전국 평균 단수의 최솟값~최댓값이며, 해당 지역이나 올해 농지의 예상 수확량을 보장하지 않습니다.','Range of national annual mean yields in 2021–2025, not a guaranteed regional or current-year field yield.')}</p><p>{ko?ref.practice:names[i]} · {ref.commodity}</p><p>{t('쌀은 도정 기준, 감자는 봄감자 기준입니다. 고추는 원 통계 생산물 기준이며 생고추 물량으로 임의 환산하지 않습니다.','Rice uses the milling basis, potato spring cultivation, and pepper the original statistical commodity, not an arbitrary fresh-weight conversion.')}</p><a href={ref.sourceUrl} target="_blank" rel="noreferrer">{t('공식 생산 통계 원문','Official production statistics')}</a> · <a href={cropGuidelines[code].source} target="_blank" rel="noreferrer">{t('작업 가이드 근거','Work guideline source')}</a><p>{t('수급 기준 미확보 · 감점 미적용. 약제·시비는 예찰과 처방에 따라 판단합니다.','Supply threshold unavailable; no penalty applied. Treatment depends on observation and prescription.')}</p></details></section>;
 })}</div>
 <details className="section-space"><summary>{t('전체 작물·작형 목록 (106개)','Full crop / practice catalog (106)')}</summary><CropCatalogPanel/></details>
 </div>;
}
