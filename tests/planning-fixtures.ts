import type {Mission} from '../lib/types';
export function completedSteps(pnu:string,year:number,crop:string,codes:string[]):Mission[]{return codes.map((code,i)=>({id:`prior-${crop}-${code}`,operationKey:`${year}:${pnu}:${crop}:${code}`,fieldId:pnu,scheduledDate:`${year}-04-01`,start:i,duration:1,status:'COMPLETED',staff:0,transport:0,resourceId:null} as unknown as Mission));}
