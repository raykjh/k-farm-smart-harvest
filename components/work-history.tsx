'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from './language';
export default function WorkHistory({month}:{month:number}){
 const {locale}=useLanguage(),ko=locale==='ko';const [items,setItems]=useState<any[]>([]),[error,setError]=useState(false);
 useEffect(()=>{let active=true;fetch('/api/work-history').then(async r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(active)setItems(d.items)}).catch(()=>{if(active)setError(true)});return()=>{active=false}},[]);
 const labels:Record<string,string>={NEEDS_OBSERVATION:'기상자료 확인 필요',SIMULATED_HELD:'가상 보류',SIMULATED_COMPLETED:'가상 완료',NEEDS_HOURLY_REVIEW:'작업시간 날씨 확인 필요',SIMULATION_CANDIDATE:'가상 실행 검토 가능'};
 const shown=items.filter(x=>!month||Number(x.plannedDate.slice(5,7))===month);
 return <details className="card section-space"><summary>{ko?'과거 계획·실적 검토':'Past plan / execution review'} · {shown.length}</summary><p>{ko?'실제 관측자료 기반 가상 검토입니다. 강수 공란은 데모 계산에서 0mm로 간주합니다. 표시된 처리일은 가상 이력이며 실제 작업 증빙이 아닙니다.':'Simulation review using observations. Blank rain is treated as zero for this demo. Simulated dates are not real execution evidence.'}</p>{error&&<p role="alert">{ko?'이력을 불러오지 못했습니다.':'History unavailable.'}</p>}<div className="table-wrap"><table><thead><tr>{(ko?['작업','당초 예정','현재 예정','가상 처리일','검토 결과']:['Task','Original plan','Current plan','Simulated date','Assessment']).map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{shown.map(x=><tr key={x.missionId}><td>{x.missionId}</td><td>{x.originalPlannedDate??'—'}</td><td>{x.plannedDate}</td><td>{x.simulatedFinishedAt??'—'}</td><td>{ko?labels[x.assessment]??x.assessment:x.assessment}</td></tr>)}</tbody></table></div></details>
}
