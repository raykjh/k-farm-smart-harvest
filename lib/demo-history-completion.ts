import type {State} from './types';
import type {ExecutionView} from './execution-view';

type Evidence=ExecutionView&{recordId:string};
export const DEMO_COMPLETION_RULE='approved-normal-history-v1';
export function demoCompletionBatch(raw:State,evidence:Evidence[],before:string,confirmedAt:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(before)||!Number.isFinite(Date.parse(before))||!Number.isFinite(Date.parse(confirmedAt)))throw Error('실적 기준일 확인 필요');
 const state=structuredClone(raw),records:{id:string;payload:Record<string,unknown>}[]=[];
 const skipped={actual:0,cancelled:0,alreadyCompleted:0};
 for(const m of state.missions){
  if(!m.scheduledDate||m.scheduledDate>=before)continue;
  const field=state.fields.find(f=>f.id===m.fieldId);
  if(field?.source!=='DEMO_ASSUMPTION'){skipped.actual++;continue;}
  const matching=evidence.filter(e=>e.missionId===m.id&&e.plannedDate===m.scheduledDate);
  if(matching.some(e=>e.source==='ACTUAL')){skipped.actual++;continue;}
  if(m.status==='CANCELLED'){skipped.cancelled++;continue;}
  const previous=matching.find(e=>e.source==='DEMO_SIMULATION');
  if(m.status==='COMPLETED'&&previous?.assessment==='SIMULATED_COMPLETED'&&previous.simulatedFinishedAt){skipped.alreadyCompleted++;continue;}
  const start=480+((m.start%32)+32)%32*15,end=start+m.duration*15;
  if(!Number.isInteger(m.duration)||m.duration<=0||end>1440)throw Error(`작업시간 확인 필요: ${m.id}`);
  const stamp=(minute:number)=>new Date(Date.parse(m.scheduledDate+'T00:00:00+09:00')+minute*60000).toISOString();
  const finishedAt=stamp(end);if(Date.parse(finishedAt)>Date.parse(confirmedAt))throw Error('미래 실적은 만들 수 없습니다.');
  const id=`${DEMO_COMPLETION_RULE}:${before}:${m.id}`;
  records.push({id,payload:{missionId:m.id,plannedDate:m.scheduledDate,source:'DEMO_SIMULATION',sourceBatchId:field.demoBatchId??null,assessment:'SIMULATED_COMPLETED',actualStartedAt:null,actualFinishedAt:null,actualQuantity:null,simulatedStartedAt:stamp(start),simulatedFinishedAt:finishedAt,confirmedBy:'USER_APPROVED_DEMO_HISTORY',confirmedAt,reason:'사용자 요청: 기준일 이전 데모 작업을 정상 수행한 시나리오로 보완. 실제 작업 증빙이나 기상 관측 판정이 아닙니다.',ruleVersion:DEMO_COMPLETION_RULE,supersedesId:previous?.recordId??null,missionSnapshot:structuredClone(m),planVersion:raw.planVersion}});
  m.status='COMPLETED';
 }
 if(records.length){state.planVersion++;for(const revision of state.revisions)if(revision.status==='REVIEW_REQUIRED')revision.status='SUPERSEDED';}
 return {state,records,skipped};
}
