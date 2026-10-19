'use client';
import {cropDisplayNames,type SupportedCropCode} from '@/lib/crop-registry';
import {PUBLIC_CRITERIA_CHECKED_ON,publicCriteriaCoverage,publicRegionalCriteria,publicYieldCriteria} from '@/lib/public-crop-criteria';
import {useLanguage} from './language';
import {operationalText} from '@/lib/operational-i18n';
import {Button} from './ui/button';

export default function PublicCriteriaReview({global,canManage,centerId,centers,onYield,onRegion}:{
 global:boolean;canManage:boolean;centerId:string;centers:{id:string;name:string}[];
 onYield:(id:string)=>void;onRegion:(centerId:string,crop:SupportedCropCode)=>void;
}){
 const {locale}=useLanguage(),ko=locale==='ko',t=(a:string,b:string)=>ko?a:b,names=cropDisplayNames(ko);
 const regions=centers.filter(c=>publicRegionalCriteria.centerIds.includes(c.id)&&(global||c.id===centerId));
 return <details className="section-space" data-testid="public-criteria"><summary>{t('공개 기준자료','Public reference data')} · {publicYieldCriteria.length} / {publicCriteriaCoverage.length} {t('작물 단수 확인','crop yields checked')}</summary>
 <p>{t('자료는 열람·입력 보조용입니다. 계산에는 유효기간을 지정해 저장한 기준만 사용합니다. 아래 범위는 과거 전국 연평균 단수의 최솟값~최댓값이며 농지별 예측 신뢰구간이 아닙니다.','These sources support review and data entry. Only saved, unexpired criteria enter calculations. Ranges are historical national annual means, not field prediction intervals.')}</p>
 <div className="table-wrap" role="region" aria-label={t('공개 단수 자료표','Public yield reference table')} tabIndex={0}><table style={{minWidth:800}}><thead><tr>{[t('작물 · 생산물 기준','Crop / commodity'),t('통계연도','Statistical years'),t('kg / 1,000 m²','kg / 1,000 m²'),t('적용 조건 · 출처','Conditions / source'),t('검토','Review')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{publicYieldCriteria.map(r=><tr key={r.id}>
 <td>{names[r.crop]}<br/><small>{r.basis[ko?0:1]}</small></td><td>{r.years[0]}–{r.years.at(-1)}</td><td>{r.kgPer1000m2.low.toLocaleString()}–{r.kgPer1000m2.high.toLocaleString()}</td><td>{r.qualification[ko?0:1]}<br/><a href={r.sourceUrl} target="_blank" rel="noreferrer">{t('공식 통계','Official statistics')}</a> · {r.publishedOn}<br/><small>{operationalText(r.locator,locale)}</small></td>
 <td>{canManage&&global?<Button size="sm" variant="outline" onClick={()=>onYield(r.id)}>{names[r.crop]} {t('기준 불러오기','load reference')}</Button>:t('총괄 검토 후 적용','Global review required')}</td>
 </tr>)}</tbody></table></div>
 <p>{t('단수 미수집','Yield not yet collected')}: {publicCriteriaCoverage.filter(r=>r.yield==='NOT_COLLECTED').map(r=>names[r.crop]).join(', ')}</p>
 <p>{t('전국 적정 공급량은 미확보입니다. 과거 생산량을 수급 기준으로 대체하거나 자동 감점하지 않습니다. 작물별 작업기간·기온·인원 기준은 별도의 지역 검토가 필요합니다.','No national appropriate-supply target has been established. Historical output is not a substitute and triggers no automatic penalty. Work windows, temperatures and crews need separate regional review.')}</p>
 <h3>{t('장수군 특산물 참고','Jangsu county specialty reference')}</h3><p><a href={publicRegionalCriteria.sourceUrl} target="_blank" rel="noreferrer">{t('장수군청 농특산물 목록','Jangsu county specialty directory')}</a> · {t('고추 · 사과','Pepper / apple')} · {t('확인','Checked')} {PUBLIC_CRITERIA_CHECKED_ON}</p><p>{publicRegionalCriteria.review[ko?0:1]}</p>
 {canManage&&regions.map(c=><div className="action-row" key={c.id}><span>{c.name}</span>{publicRegionalCriteria.crops.map(crop=><Button key={crop} size="sm" variant="outline" onClick={()=>onRegion(c.id,crop)}>{names[crop]} {t('검토 후보 불러오기','load candidate')}</Button>)}</div>)}
 <small>{t('지역 후보는 가점 0으로 불러옵니다. 자료를 불러오는 것만으로 기존 계획·예약을 변경하지 않습니다.','Regional candidates load with zero preference points. Loading data does not change plans or reservations.')}</small>
 </details>;
}
