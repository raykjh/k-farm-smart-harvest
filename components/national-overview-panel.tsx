'use client';
import {useState} from 'react';
import {nationalDisplayRows} from '@/lib/national-display';
import {centerText,addressText} from '@/lib/display-language';
import {cropCodes,cropDisplayNames,type SupportedCropCode} from '@/lib/crop-registry';
import type {buildNationalOverview} from '@/lib/national-overview';
import {InformationShell,LoadState,useReferenceData} from './information-shared';
import {useLanguage} from './language';
import GyebukMap from './gyebuk-map';
import RegionFilter from './region-filter';
import styles from './information.module.css';
type Data=ReturnType<typeof buildNationalOverview>;
export default function NationalOverviewPanel(){
 const {locale}=useLanguage(),ko=locale==='ko',t=(a:string,b:string)=>ko?a:b,names=cropDisplayNames(ko);
 const [year,setYear]=useState(new Date().getFullYear()),[quarter,setQuarter]=useState(''),[crop,setCrop]=useState(''),[center,setCenter]=useState(''),[region,setRegion]=useState('');
 const query=new URLSearchParams({year:String(year),...quarter?{quarter}:{},...crop?{crop}:{},...center?{center}:{},...region?{region}:{}}),{data,error,retry}=useReferenceData<Data>('/api/national-overview?'+query);
 const number=(v:number)=>v.toLocaleString(ko?'ko-KR':'en-US',{maximumFractionDigits:1}),hectares=(v:number)=>number(v/10000);
 const markers=(data?.centers??[]).filter(c=>c.rows&&c.longitude!==null&&c.latitude!==null).map(c=>({id:c.id,longitude:c.longitude!,latitude:c.latitude!,label:centerText(c.name,locale)}));
 return <InformationShell kind="national"><section className={styles.paper}><div className={styles.section}><div className={styles.inlineFilter}>
 <label>{t('기준연도','Year')} <input type="number" min={2000} max={2200} value={year} onChange={e=>setYear(Number(e.target.value))}/></label>
 <label>{t('분기','Quarter')} <select value={quarter} onChange={e=>setQuarter(e.target.value)}><option value="">{t('전체','All')}</option>{[1,2,3,4].map(q=><option key={q} value={q}>Q{q}</option>)}</select></label>
 <label>{t('작물','Crop')} <select value={crop} onChange={e=>setCrop(e.target.value)}><option value="">{t('전체 작물','All crops')}</option>{cropCodes.map(c=><option key={c} value={c}>{names[c]}</option>)}</select></label>
 <label>{t('센터','Center')} <select value={center} onChange={e=>setCenter(e.target.value)}><option value="">{t('전국 참여 센터','All participating centers')}</option>{data?.centers.map(c=><option key={c.id} value={c.id}>{centerText(c.name,locale)}</option>)}</select></label>
 <RegionFilter onChange={setRegion}/>
 <button className={styles.button} onClick={retry}>{t('새로고침','Refresh')}</button>
 </div><LoadState error={error} loading={!data&&!error} retry={retry}/>{data&&<><div className={styles.summaryGrid}><div><span>{t('참여 센터 · 확정 재배','Centers · approved cultivations')}</span><strong>{data.summary.centers} · {number(data.summary.cultivations)}</strong><small>{t('승인 대기','Awaiting approval')} {data.summary.pendingPlans}</small></div><div><span>{t('확정 작기 면적','Approved cycle area')}</span><strong>{hectares(data.summary.approvedAreaM2)} ha</strong><small>{t('재배 진행 기간','Within cultivation period')} {hectares(data.summary.growingAreaM2)} ha</small></div><div><span>{t('수확 작업 완료','Harvest work confirmed')}</span><strong>{hectares(data.summary.harvestCompletedAreaM2)} ha</strong><small>{t('지연 작업','Overdue tasks')} {data.summary.overdue}</small></div></div>
 <p className={styles.metadata}>{data.asOf} · {t('참여 농지 집계 · 미참여 지역은 미집계','Participating fields · other regions uncounted')} · <a href="/supply-info">{t('공식 전국 수급 자료','Official national supply evidence')}</a></p>
 <div className={styles.nationalMap}><GyebukMap national label={t('참여 센터','Participating centers')} markers={markers} onMarker={setCenter}/></div>
 {data.centers.some(c=>c.rows&&(c.longitude===null||c.latitude===null))&&<p className={styles.metadata}>{t('위치 미등록 센터는 아래 표에 표시됩니다.','Centers without registered coordinates remain in the table.')}</p>}
 <div className={styles.scroll}><table className={styles.table}><thead><tr>{[t('센터 · 지역','Center · region'),t('작물','Crop'),t('승인 대기 / 확정','Pending / approved'),t('진행 / 수확 완료 ha','Growing / harvested ha'),t('예상 생산량 kg','Expected output kg'),t('출하 기록 kg','Recorded shipments kg'),t('지연 · 인력 · 장비','Overdue · labor · equipment')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{nationalDisplayRows(data.rows).map(r=><tr key={JSON.stringify([r.centerId,r.region,r.crop,r.quarter])}><td>{centerText(r.centerName,locale)}<small>{addressText(r.region,locale)} · {r.quarter?'Q'+r.quarter:t('복수 연도','Multiple years')}</small></td><td>{names[r.crop as SupportedCropCode]}</td><td>{hectares(r.plannedAreaM2)} / {hectares(r.approvedAreaM2)} ha<small>{r.pendingPlans} / {r.cultivations} {t('건','cycles')}</small></td><td>{hectares(r.growingAreaM2)} / {hectares(r.harvestCompletedAreaM2)}</td><td>{r.production.length?r.production.map(p=><span key={p.commodity}>{number(p.low)}–{number(p.high)}<small>{p.commodity}</small></span>):'—'}{r.missingYield>0&&<small>{t('기준 없음','No yield basis')} {r.missingYield}</small>}</td><td>{r.shipments.length?r.shipments.map(s=><span key={s.commodity}>{number(s.kg)}<small>{s.commodity} · {s.entries} {t('건','entries')}</small></span>):'—'}</td><td>{r.overdue} · {r.laborShortages} · {r.equipmentHolds}</td></tr>)}</tbody></table></div>{!data.rows.length&&<p className={styles.empty}>{t('이 조건에 해당하는 참여 재배 기록이 없습니다.','No participating cultivation records match these filters.')}</p>}
 </>}</div></section></InformationShell>;
}
