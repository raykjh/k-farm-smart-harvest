export function isClosedTask(status:string){return status==='COMPLETED'||status==='CANCELLED'}
export const cancellationReasons=[['UNNECESSARY','작업 불필요로 생략','No longer needed'],['WITHDRAWAL','농부 위탁 취소에 따른 작업 종료','Farmer withdrawal'],['CROP_CHANGE','작물 변경에 따른 작업 종료','Crop changed']] as const;
export type TaskCancellation={requestId:string;category:typeof cancellationReasons[number][0];reason:string;confirmedAt:string;confirmedBy:string};
