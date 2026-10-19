export function isClosedTask(status:string){return status==='COMPLETED'||status==='CANCELLED'}
export const cancellationReasons=[['UNNECESSARY','작업 불필요로 생략','No longer needed'],['WITHDRAWAL','농지 소유주 위탁취소에 따른 작업종료','Landowner withdrawal'],['CROP_CHANGE','작물 변경에 따른 작업 종료','Crop changed']] as const;
export type TaskCancellation={requestId:string;category:typeof cancellationReasons[number][0];reason:string;confirmedAt:string;confirmedBy:string};
export type OperationKind='PROCESS'|'REPEAT'|'CONDITIONAL'|'INSPECTION';
/** An omission closes only an optional operation with a recorded operator decision.
 * It is not completion and must never satisfy a required successor dependency. */
export function isRecordedOptionalCancellation(task:{status:string;kind?:OperationKind;cancellation?:TaskCancellation}){
 const c=task.cancellation;
 return task.status==='CANCELLED'&&(task.kind==='CONDITIONAL'||task.kind==='INSPECTION')&&c?.category==='UNNECESSARY'
  &&typeof c.requestId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(c.requestId)
  &&typeof c.reason==='string'&&!!c.reason.trim()&&typeof c.confirmedBy==='string'&&!!c.confirmedBy.trim()
  &&typeof c.confirmedAt==='string'&&Number.isFinite(Date.parse(c.confirmedAt));
}
