import type {ReplanInput} from './annual-replanning';
import type {ReplanAlternative} from './planning-decision';
import type {ScheduleChangeRow} from './schedule-display';
export const AUTOMATIC_REPLAN_POLICY='equipment-harvest-carryover-v3';

// These are internal search steps, not choices the operator must compare.
export const automaticSearchSteps:ReplanAlternative[]=[
 {id:'preserve',label:'센터 내 빈자리',scope:'PRESERVE',allowBorrowing:false},
 {id:'expand',label:'관련 일정 재조정',scope:'EXPAND',allowBorrowing:false},
 {id:'adjacent',label:'인접 센터 차용',scope:'EXPAND',allowBorrowing:true},
];
export type RepairLoanRequest={id:string;machineId:string;ownerCenterId:string;ownerName:string;from:string;to:string;missionIds:string[]};
export type AutomaticReplanResult={status:'APPLIED'|'RESOURCE_REQUIRED';requestId:string;changes?:number;changeRows?:ScheduleChangeRow[];dates?:string[];borrowedMachines?:string[];manualTasks?:number;source?:string;message?:string;requirements?:ResolutionNeed[];loanRequests?:RepairLoanRequest[]};
export type ResolutionNeed={missionId:string;task:string;from:string;to:string;equipment:string|null;people:number|null;minutes:number|null;steps:('BORROW'|'PROCUREMENT'|'MANUAL'|'LABOR'|'PREREQUISITE'|'WINDOW'|'DATA')[];note:string};
type Call=(body:Record<string,unknown>)=>Promise<any>;

/** One authenticated operator command authorizes a complete bounded replan.
 * The server still verifies the model, then revalidates and commits atomically.
 * UI simplicity never removes the evidence retained in planningDecision. */
export async function runAutomaticReplan(input:ReplanInput,requestId:string,invoke:Call,liveAi:boolean,needs:()=>Promise<ResolutionNeed[]>,beforeCommit?:(proposalId:string,result:AutomaticReplanResult)=>Promise<void>):Promise<AutomaticReplanResult>{
 const compared=await invoke({...input,action:'compare',useAi:liveAi,searchMode:input.resourceReview?undefined:'LOCAL_FIRST',...(input.resourceReview?{decisionPriority:'MIN_EXTERNAL'}:{}),alternatives:automaticSearchSteps});
 const recommendation=compared.recommendation;
 const choice=compared.results.find((c:any)=>c.id===recommendation?.alternativeId&&c.status==='FEASIBLE');
 if(!choice){
  const unfinished=compared.results.find((c:any)=>['TIME_LIMIT','SIZE_LIMIT','INVALID'].includes(c.result?.failureKind));
  if(unfinished)throw Error(`${unfinished.reason??'일정 계산을 끝내지 못했습니다.'} 장비 부족으로 확정하지 않았습니다. 다시 계산하세요.`);
  return {status:'RESOURCE_REQUIRED',requestId,message:'작업을 포기하지 않고 추가 자원·작업 조건 확인 요청으로 이어갑니다.',requirements:await needs()};
 }
 if(recommendation.rationaleCheck?.status!=='VERIFIED'||recommendation.priorityCheck?.status==='MISMATCH')throw Error('AI 배치 결과를 검증하지 못했습니다. 기존 일정은 유지했으며 다시 요청할 수 있습니다.');
 const preview=await invoke(choice.previewRequest);
 if(preview.status!=='FEASIBLE'||!preview.proposalId)throw Error('배치 중 조건이 변경되었습니다. 기존 일정은 유지했습니다. 다시 요청하세요.');
 const result:AutomaticReplanResult={status:'APPLIED',requestId,source:recommendation.source,changes:preview.diff.length,
  dates:[...new Set<string>(preview.diff.map((d:any)=>d.date))].sort(),
  borrowedMachines:[...new Set<string>(preview.assignments?.filter((a:any)=>choice.result?.borrowedMachineIds?.includes(a.resource)).map((a:any)=>a.resource)??[])],
  manualTasks:preview.manualConversions?.length??0};
 // Persist the link before committing. The approval transaction stores the
 // receipt with the plan, so a lost response cannot cause a second application.
 await beforeCommit?.(preview.proposalId,result);
 // Even a no-change plan can carry a newly registered repair period.
 const approved=await invoke({action:'approve',proposalId:preview.proposalId});
 if(approved.changeRows)result.changeRows=approved.changeRows;
 return result;
}
