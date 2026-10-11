import {isClosedTask} from '@/lib/task-lifecycle';
import {localized,useLanguage} from './language';
import {Wind,Tractor} from 'lucide-react';
import {restricted,weatherBlocked,windLimit} from '@/lib/weather';
import {slotLabel,type State} from '@/lib/types';
export function WeatherImpact({state:s}:{state:State}){
 const {locale}=useLanguage();
 if(!s.events.length)return null;
 const equipmentJobs=s.missions.filter(m=>m.resourceId&&!isClosedTask(m.status));
 const direct=equipmentJobs.filter(m=>s.events.some(e=>restricted(s,m,e)));
 const unchanged=equipmentJobs.filter(m=>!s.events.some(e=>restricted(s,m,e)));
 return localized(<section className="card section-space" data-testid="weather-impact"><div className="card-head"><h2>강풍 영향은 작업마다 달라요</h2><span className="badge warn">작업별 판단 · 모의 기준</span></div><div className="split"><div className="rec"><h3><Wind size={20}/> 드론 방제 · 강풍 시간대 제한</h3><p className="description">{direct.length}건은 작업별 제한을 적용합니다. 현재 {direct.filter(m=>weatherBlocked(s,m)).length}건이 금지 시간대와 겹칩니다. 재계획 후 안전한 시간대로 이동합니다.</p></div><div className="rec" data-testid="ground-maintained"><h3><Tractor size={20}/> 조건을 충족한 지상 작업 · 일정 유지</h3>{unchanged.map(m=>{const machine=s.machines.find(x=>x.id===m.resourceId);const safe=machine?.status==='AVAILABLE'&&!machine.safetyLock;return <div key={m.id}><p className="description"><b>{m.fieldId} 농지 · {m.label}</b><br/>{slotLabel(m.start)} · {m.duration*15}분 · {m.resourceId}</p><span className={`badge ${safe?'':'red'}`}>{safe?'기존 일정 유지 · 실행 가능 (모의)':'안전잠금/장비 상태 확인 · 실행 불가'}</span><p className="small muted section-space">시나리오 풍속 {s.events[0].windMs}m/s &lt; 작업 제한 {windLimit(s,m)}m/s</p></div>})}{!unchanged.length&&<p className="description">조건이 확인된 지상 작업이 아직 없습니다.</p>}</div></div><p className="description small">드론 5m/s·지상 파종 12m/s는 시연용 가정입니다. 실제 제조사·작업 기준이 아닙니다. 지상 약제 살포나 기준 미확인 작업은 지상 장비라는 이유로 제외하지 않습니다. 안전잠금 및 운송·인력 충돌은 별도로 검사합니다.</p></section>,locale);
}
