import {slotLabel,type State} from './types';
import {jobs,solve} from './scheduler';
import {restricted,weatherBlocked} from './weather';

export function impactFacts(s:State){
 const all=jobs(s);
 const blocked=all.filter(m=>weatherBlocked(s,m));
 return {
  source:'DEMO_ASSUMPTION',approvalStatus:'NOT_APPROVED',
  weatherBlockedMissionCount:blocked.length,weatherBlockedMissionIds:blocked.map(m=>m.id),
  sharedResourceScopeMissionCount:all.length,
  unchangedMissions:all.filter(m=>!s.events.some(e=>restricted(s,m,e))).map(m=>({missionId:m.id,startSlot:m.start})),
  timeUnit:'15-minute working slot; 32 slots per working day, 08:00–16:00; NOT elapsed hours',
  weather:s.events.map(e=>({windMetersPerSecond:e.windMs,blockedStartSlot:e.start,blockedEndSlotExclusive:e.end})),
  staffCount:s.staffCount,transportVehicleCount:s.transportCount,
  lockedMachineIds:s.machines.filter(m=>m.safetyLock).map(m=>m.id),
 };
}

// Authoritative user-facing prose is rendered from verified facts, never LLM text.
export function verifiedSummary(s:State,result:Awaited<ReturnType<typeof solve>>){
 const facts=impactFacts(s);
 const lines=[`모의 자료 기준: 기상 금지 시간대와 겹치는 작업 ${facts.weatherBlockedMissionCount}건, 공동자원 검토 대상 ${facts.sharedResourceScopeMissionCount}건입니다.`];
 if(result.feasible){
  lines.push(`검증된 변경안: ${result.diff.length}건의 일정을 조정했습니다. 장비·운송·인력 중복과 작업 금지 시간대·마지막 안전일을 검사했습니다.`);
  for(const m of facts.unchangedMissions)lines.push(`${m.missionId}: ${slotLabel(m.startSlot)} 기존 일정 유지.`);
  for(const d of result.diff)lines.push(`${d.missionId}: ${slotLabel(d.before)} → ${slotLabel(d.after)}.`);
  lines.push('담당자 일괄 승인 전 변경안입니다. 기존 확정 계획은 변경하지 않았으며, 장비 실행·농부 알림 발송은 하지 않았습니다.');
 }else lines.push('현재 조건에서 실행 가능한 변경안을 찾지 못했습니다. 담당자 검토가 필요하며, 계획 변경·장비 실행·농부 알림 발송은 하지 않았습니다.');
 return lines.join('\n');
}
