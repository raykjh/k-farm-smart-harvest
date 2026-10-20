'use client';
import {useLanguage} from './language';
import {cropDisplayNames} from '@/lib/crop-registry';
import {centerRegistry} from '@/lib/center-registry';

type Scenario={low:number;base:number;high:number};
export type IntegratedFieldRow={
 field:string;centerId:string;label?:string;crop:string;baselineCrop:string|null;changed:boolean|null;areaM2:number;
 context:{nationalOutlook:string;specialty:string;participantSupply:string;neighborCompatible:boolean|null};
 economics:{status:string;comparable:boolean;revenue:Scenario|null;knownCost:Scenario|null;balanceAfterKnownCosts:Scenario|null;missingComponents:string[];
  reference:{asOf:string;checkedOn:string;validUntil:string;sourceDataKind:string;priceBasis:string;priceStage:string;costMode:string;sourceUrl?:string;version?:string}|null};
};
const missingLabels:Record<string,[string,string]>={
 OWN_LABOR_AND_CAPITAL_NOT_INCLUDED:['자가노동·자본 비용 미포함','Own labor and capital excluded'],COST_EXCLUDED:['근거에 포함되지 않은 비용·출하 조건','Excluded costs and marketable-grade assumptions'],
 AREA_COMMODITY_OR_HARVEST_PERIOD_REQUIRED:['면적·생산물·수확기간','Area, commodity or harvest period'],INVALID_ECONOMIC_REFERENCE:['자료 형식','Reference contract'],AMBIGUOUS_ECONOMIC_REFERENCE:['중복 근거','Overlapping references'],CURRENT_MATCHING_ECONOMIC_REFERENCE_REQUIRED:['수확기간과 생산물에 맞는 근거','Matching commodity and harvest reference'],ECONOMIC_CALCULATION_OUT_OF_RANGE:['계산 범위','Calculation range'],FARM_GATE_PRICE_REQUIRED_WHOLESALE_IS_NOT_RECEIPTS:['농가수취가격','Farm-gate price'],VALID_EXECUTABLE_TASK_COST_BASIS_REQUIRED:['실행 가능한 작업 비용','Executable task cost basis'],ORDINARY_LABOR_POLICY_REQUIRED:['해당 연도 일반 인력 보수','Applicable ordinary-worker pay'],OPERATOR_LABOR_POLICY_REQUIRED:['장비 운전 인력 보수','Equipment operator pay'],REGISTERED_EQUIPMENT_RATE_REQUIRED:['등록 장비 비용','Registered equipment cost'],STATISTICAL_TOTAL_BELOW_KNOWN_OPERATIONAL_COST:['통계 비용과 실제 자원 비용의 범위','Statistical versus operational cost coverage'],CURRENT_STATISTICAL_COST_REFERENCE_REQUIRED:['유효한 통계 비용','Current statistical cost reference'],CURRENT_COST_REFERENCE_REQUIRED:['유효한 비용 근거','Current cost evidence'],OTHER_COSTS_INCOMPLETE:['기타 비용','Other costs'],UNPLACED_REQUIRED_TASK_COSTS:['미배치 필수 작업 비용','Unplaced essential-task costs'],
};
export function IntegratedPlanFields({fields}:{fields:IntegratedFieldRow[]|undefined}){
 const {locale}=useLanguage(),ko=locale==='ko',t=(a:string,b:string)=>ko?a:b,crops=cropDisplayNames(ko);
 const crop=(id:string|null)=>id?(crops[id as keyof typeof crops]??id):'—';
 const center=(id:string)=>centerRegistry.find(c=>c.id===id)?.[ko?'name':'township']??id;
 const money=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)?`${value.toLocaleString(ko?'ko-KR':'en-US')} ${t('원','KRW')}`:'—';
 if(!fields?.length)return <p>{t('농지별 비교 근거는 새로 계산한 계획에서 확인할 수 있습니다.','Field-level comparisons are available in a newly calculated plan.')}</p>;
 const reasons=(row:IntegratedFieldRow)=>{
  const c=row.context,values:string[]=[];
  if(c.nationalOutlook==='OVERSUPPLY_RISK')values.push(t('수확기 공급과잉 주의','Harvest oversupply risk'));
  else if(c.nationalOutlook==='UNKNOWN')values.push(t('수확기 수급 미확인','Harvest market unassessed'));
  if(['CONCENTRATION','POSSIBLE_CONCENTRATION'].includes(c.participantSupply))values.push(t('참여 농지 작물 집중 주의','Participating crop concentration'));
  if(c.specialty==='ESTABLISHED')values.push(t('기존 지역 특화','Established regional crop'));
  if(c.specialty==='DEVELOPMENT_CANDIDATE')values.push(t('특화 시험재배 후보','Specialty trial candidate'));
  if(c.neighborCompatible===true)values.push(t('인접 작물 일치 참고','Matching neighboring crop'));
  values.push(row.economics.comparable?t('확인 비용 기준 비교 가능','Comparable on reviewed costs'):t('경제성 미확인 · 금액 비교 불가','Economics incomplete · amounts not comparable'));
  return values.join(' · ');
 };
 return <>
  <p>{t('같은 입력으로 계산한 현재 기준안과 추천안을 비교합니다. 진행 중인 확정 재배를 교체하지 않습니다.','Compare the current baseline and recommendation using the same inputs. Active confirmed cultivations are not replaced.')}</p>
  <div className="table-wrap"><table aria-label={t('농지별 작물 비교','Field crop comparison')}><thead><tr>{[t('농지','Field'),t('현재 기준안','Current baseline'),t('추천안','Recommendation'),t('핵심 근거','Key evidence')].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{fields.map(row=><tr key={row.field}>
   <td>{row.label??row.field}<br/><small>{center(row.centerId)} · {row.areaM2.toLocaleString()} ㎡</small></td>
   <td>{crop(row.baselineCrop)}</td><td>{crop(row.crop)}<br/><small>{row.changed===null?t('기준안 미확인','Baseline unavailable'):row.changed?t('변경','Changed'):t('기준안과 동일','Same as baseline')}</small></td>
   <td>{reasons(row)}<details><summary>{t('경제성·근거 상세','Economics and evidence')}</summary>
    {!row.economics.comparable&&<p>{t('일부 자료·비용이 확인되지 않았습니다. 아래 잔액은 순이익이 아니며 선택안의 우열을 정하는 금액 지표로 사용할 수 없습니다.','Some evidence or costs are unconfirmed. The balances below are not net profit and cannot rank the plans.')}</p>}
    <div className="table-wrap"><table aria-label={`${row.field} ${t('경제성 시나리오','economic scenarios')}`}><thead><tr><th>{t('항목','Item')}</th><th>{t('불리한 조건','Unfavorable')}</th><th>{t('기준 조건','Base')}</th><th>{t('유리한 조건','Favorable')}</th></tr></thead><tbody>
     <tr><th>{t('농가수취 수입','Farm-gate receipts')}</th><td>{money(row.economics.revenue?.low)}</td><td>{money(row.economics.revenue?.base)}</td><td>{money(row.economics.revenue?.high)}</td></tr>
     <tr><th>{t('확인 비용','Known costs')}</th><td>{money(row.economics.knownCost?.high)}</td><td>{money(row.economics.knownCost?.base)}</td><td>{money(row.economics.knownCost?.low)}</td></tr>
     <tr><th>{t('확인 비용 차감 잔액','Balance after known costs')}</th><td>{money(row.economics.balanceAfterKnownCosts?.low)}</td><td>{money(row.economics.balanceAfterKnownCosts?.base)}</td><td>{money(row.economics.balanceAfterKnownCosts?.high)}</td></tr>
    </tbody></table></div>
    <p>{t('수량·가격·비용 가정의 시나리오이며 가격 예측이나 확정 수익이 아닙니다. 불리한 조건은 낮은 수입과 높은 비용을 함께 반영합니다.','These are yield, price and cost scenarios, not a price forecast or guaranteed return. The unfavorable case combines lower receipts and higher costs.')}</p>
    {!!row.economics.missingComponents.length&&<p>{t('미확인','Unconfirmed')}: {row.economics.missingComponents.map(code=>missingLabels[code.split(':')[0]]?.[ko?0:1]??t('추가 근거','Additional evidence')).join(' · ')}</p>}
    {row.economics.reference&&<p>{row.economics.reference.sourceDataKind==='SYNTHETIC_FIXTURE'?t('가상 입력 검증자료','Synthetic validation inputs'):t('자료 기준일','Evidence as of')}: {row.economics.reference.asOf} · {t('검토일','Reviewed')} {row.economics.reference.checkedOn} · {t('유효기한','Valid until')} {row.economics.reference.validUntil}<br/>{row.economics.reference.costMode==='STATISTICAL_TOTAL'?t('통계 비용 사용 · 장비·인건비 추가 차감 없음','Statistical cost reference · equipment and labor are not deducted again'):t('확인된 항목별 비용','Reviewed itemized costs')}{row.economics.reference.sourceUrl?.startsWith('https://')&&<> · <a href={row.economics.reference.sourceUrl} target="_blank" rel="noreferrer">{t('출처','Source')}</a></>}</p>}
   </details></td>
  </tr>)}</tbody></table></div>
 </>;
}
