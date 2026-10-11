'use client';
import {serviceRegions,serviceRegionScope,serviceRegionSource} from '@/lib/service-regions';
import {useLanguage} from './language';
export default function ServiceRegionScope(){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 return <section className="main"><h2>{t('개발 대상 지역 · 장수군 4개 면','Development scope · four townships in Jangsu')}</h2>
 <p>{t('방문 상담·농지 관리는 면별로, 장비 활용은 네 지역의 확인된 가용자원을 함께 검토합니다.','Keep farmer consultations and field custody local; consider confirmed equipment availability across the four areas.')}</p>
 <div className="table-wrap"><table><thead><tr><th>{t('담당 지역','Township')}</th><th>{t('거점 참고 기관','Reference office')}</th></tr></thead><tbody>{serviceRegions.map(r=><tr key={r.id}><td>{r.township}</td><td>{r.office}</td></tr>)}</tbody></table></div>
 <p>{t('선정된 개발 범위이며 실제 운영 협약·장비 확보를 뜻하지 않습니다. 기존 계북면 기록은 보존하며, 다른 면의 업무 권한은 저장 분리 검증 후 연결합니다.','Selected development scope, not an operating agreement or secured equipment. Existing Gyebuk records remain intact; other centers require verified storage isolation before access is enabled.')}</p>
 <small>{serviceRegionScope.version} · <a href={serviceRegionSource} target="_blank" rel="noreferrer">{t('기관 명칭 출처: 장수군청','Office names: Jangsu County')}</a></small></section>;
}
