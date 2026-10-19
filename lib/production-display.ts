import type {ProductionItem} from './continuous-production';

export function productionStatusLabel(status:ProductionItem['status'],korean:boolean){
 const labels:Record<ProductionItem['status'],[string,string]>={
  CONSENT_REQUIRED:['위임 확인','Consent needed'],PAUSED:['신규 배치 중지','New plans paused'],
  ENDED:['참여 종료','Participation ended'],EXPIRED:['참여기간 종료','Term ended'],
  WAITING_START:['참여 시작 대기','Awaiting start'],BLOCKED:['기준·자원 확인','Check criteria / resources'],
  REVIEW:['새 계획 확인','Review new plan'],SCHEDULED:['다음 재배 연결됨','Next cultivation scheduled'],
 };
 return labels[status][korean?0:1];
}
