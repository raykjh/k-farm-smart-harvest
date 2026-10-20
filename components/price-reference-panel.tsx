'use client';
import {useMemo,useState} from 'react';
import {historicalPriceScenario,priceProducts,type PriceCrop,type PriceDay,type PriceObservation,type PriceSelection} from '@/lib/price-reference';
import {InformationShell,LoadState,SourceLink,useReferenceData} from './information-shared';
import {useLanguage} from './language';
import styles from './information.module.css';
type History={days:PriceDay[];observations:PriceObservation[];missingDays:string[];sourceUrl:string;canImport:boolean;configured:boolean};
const day=(offset=0)=>new Date(Date.now()+9*3600000+offset*86400000).toISOString().slice(0,10);
const seriesKey=(r:PriceObservation)=>JSON.stringify([r.varietyCode,r.gradeCode,r.stage,r.regionCode,r.marketCode]);
export default function PriceReferencePanel(){
 const {locale}=useLanguage(),ko=locale==='ko',t=(a:string,b:string)=>ko?a:b;
 const [crop,setCrop]=useState<PriceCrop>('rice'),[from,setFrom]=useState(()=>day(-30)),[to,setTo]=useState(()=>day()),[series,setSeries]=useState(''),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failure,setFailure]=useState(false);
 const query=new URLSearchParams({crop,from,to}).toString(),{data,error,retry}=useReferenceData<History>('/api/price-reference?'+query);
 const choices=useMemo(()=>[...new Map((data?.observations??[]).map(r=>[seriesKey(r),r])).entries()].sort((a,b)=>a[0].localeCompare(b[0])),[data]);
 const active=choices.find(([key])=>key===series)??choices[0],selection=active?.[1] as PriceSelection|undefined;
 const rows=(data?.observations??[]).filter(r=>active&&seriesKey(r)===active[0]).sort((a,b)=>b.date.localeCompare(a.date));
 const scenario=selection&&['WHOLESALE','RETAIL'].includes(selection.stage)?historicalPriceScenario(rows,selection):null;
 const money=(n:number|null)=>n===null?'—':Math.round(n).toLocaleString(ko?'ko-KR':'en-US');
 async function collect(){setBusy(true);setMessage('');setFailure(false);try{const response=await fetch('/api/price-reference',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({crop,from,to})}),result=await response.json();if(!response.ok)throw Error(result.error);setMessage(t(`${result.observations.toLocaleString()}건 수집 · 변경 ${result.changed}일 · 동일 ${result.unchanged}일`,`${result.observations.toLocaleString()} observations · ${result.changed} changed days · ${result.unchanged} unchanged days`));retry();}catch(e){setFailure(true);setMessage(e instanceof Error?e.message:t('수집 실패','Collection failed'));}finally{setBusy(false);}}
 return <InformationShell kind="price-info"><section className={styles.paper}><div className={styles.section}><div className={styles.inlineFilter}>
  <label>{t('작물','Crop')} <select value={crop} onChange={e=>{setCrop(e.target.value as PriceCrop);setSeries('');setPage(0);}}>{Object.entries(priceProducts).map(([id,p])=><option key={id} value={id}>{ko?p.name:p.en}</option>)}</select></label>
  <label>{t('시작일','From')} <input aria-label={t('가격 시작일','Price from')} type="date" max={to} value={from} onChange={e=>{setFrom(e.target.value);setPage(0);}}/></label>
  <label>{t('종료일','To')} <input aria-label={t('가격 종료일','Price to')} type="date" min={from} max={day()} value={to} onChange={e=>{setTo(e.target.value);setPage(0);}}/></label>
  <button className={styles.button} onClick={retry}>{t('새로고침','Refresh')}</button>
  {data?.canImport&&<button className={styles.button} disabled={busy||!data.configured} onClick={collect}>{busy?t('수집 중…','Collecting…'):t('aT 자료 수집','Collect from aT')}</button>}
 </div><LoadState error={error} loading={!data&&!error} retry={retry}/>{message&&<p role={failure?'alert':'status'}>{message}</p>}
 {data&&<><p className={styles.metadata}>{t('수집 완료일','Collected dates')} {data.days.length} / {data.days.length+data.missingDays.length} · <SourceLink href={data.sourceUrl}>{t('aT 일별 가격','aT daily prices')}</SourceLink></p>
 {!choices.length?<p className={styles.empty}>{t('선택한 기간의 가격이 없습니다.','No prices for the selected period.')}{data.missingDays.length>0?' '+t('아직 수집하지 않은 날짜가 있습니다.','Some dates have not been collected.'):''}</p>:<>
 <label className={styles.inlineFilter}>{t('품종 · 등급 · 유통단계 · 시장','Variety · grade · stage · market')} <select style={{maxWidth:'100%'}} value={active?.[0]??''} onChange={e=>{setSeries(e.target.value);setPage(0);}}>{choices.map(([key,r])=><option key={key} value={key}>{r.varietyName} · {r.gradeName} · {ko?r.stageName:r.stage} · {r.regionName} {r.marketName}</option>)}</select></label>
 {scenario&&<><div className={styles.summaryGrid}>{[[t('관측 최저','Observed minimum'),scenario.low],[t('일별 중앙값','Daily median'),scenario.base],[t('관측 최고','Observed maximum'),scenario.high]].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{money(Number(value))} {t('원/kg','KRW/kg')}</strong></div>)}</div><p className={styles.metadata}>{scenario.observedDays}{t('일 관측 · 과거 가격 시나리오',' observed days · historical scenario')} · {scenario.from}–{scenario.to} · {t('농가 수취가격은 별도 확인','Farm receipts require a separate basis')}</p>{selection?.stage==='WHOLESALE'&&<a className={styles.button} href={'/cost-info?'+new URLSearchParams({crop,from,to,series:active![0]})}>{t('경제성 기준에 연결','Use in economic reference')}</a>}</>}
 <div className={styles.scroll}><table className={styles.table}><thead><tr>{[t('조사일','Survey date'),t('포장 단위','Package'),t('조사 가격','Observed price'),t('kg 환산','Per kg'),t('확인 상태','Quality')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(page*30,page*30+30).map(r=><tr key={r.id}><td>{r.date}</td><td>{r.unitSize??'—'} {r.unit}</td><td>{money(r.priceWon)} {t('원','KRW')}</td><td>{money(r.wonPerKg)}</td><td>{r.quality==='VALID'?t('확인','Valid'):r.quality==='MISSING_PRICE'?t('가격 없음','Missing price'):r.quality==='UNSUPPORTED_UNIT'?t('단위 검토','Review unit'):t('환산값 불일치','Conversion mismatch')}</td></tr>)}</tbody></table></div>
 <div className={styles.actions}><button className={styles.button} disabled={page===0} onClick={()=>setPage(p=>p-1)}>{t('이전','Previous')}</button><span>{page+1} / {Math.max(1,Math.ceil(rows.length/30))}</span><button className={styles.button} disabled={(page+1)*30>=rows.length} onClick={()=>setPage(p=>p+1)}>{t('다음','Next')}</button></div>
 </>}
 <details className={styles.standard}><summary>{t('수집 이력과 범위','Collection history and coverage')}</summary>{data.days.map(d=><p key={d.date} className={styles.metadata}>{d.date} · {d.observations.length} {t('건','rows')} · {d.retrievedAt} · {d.revision.slice(0,12)}</p>)}{data.missingDays.length>0&&<p>{t('미수집','Not collected')}: {data.missingDays.join(', ')}</p>}<p>{t('선택 시장의 조사 가격입니다. 전국 평균이나 다음 수확 가격 예측이 아닙니다.','Observed prices for the selected market; not a national average or next-harvest forecast.')}</p></details>
 </>}
 </div></section></InformationShell>;
}
