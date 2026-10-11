import type {CropCode} from './crop-guidelines';
export type OperationRule={from?:string;to?:string;machineCode?:string;laborMinutesPer1000m2?:number;setupMinutes?:number;staff?:number;transport?:number;windLimitMs?:number;rainSensitive?:boolean;occurrences?:{occurrence:number;from:string;to:string}[]};
export function operationRequirement(crop:import('./crop-registry').SupportedCropCode,code:string,mode:string,rule:OperationRule={}){
 const machineCode=rule.machineCode??(code==='plant'?(crop==='rice'?'RP':crop==='potato'?'PS':null):code==='soil'?'TR':code==='harvest'?(crop==='rice'?'CB':crop==='potato'?'PD':null):null);
 return {executionMethod:machineCode?'MANNED_MACHINE':'MANUAL',requiresOperator:!!machineCode,automaticFallback:false,machineCode,owner:machineCode?'장비':mode==='joint'?'농부':'센터 인력',laborMinutesPer1000m2:rule.laborMinutesPer1000m2??null,setupMinutes:rule.setupMinutes??30,staff:machineCode?Math.max(1,rule.staff??1):rule.staff??(mode!=='joint'?1:0),transport:rule.transport??(machineCode?1:0),windLimitMs:rule.windLimitMs??null,rainSensitive:rule.rainSensitive??true,basis:'PROVISIONAL_RESOURCE_REQUIREMENTS'};
}
