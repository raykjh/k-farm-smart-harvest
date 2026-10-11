import type {Mission} from './types';
export type Simulation={kind:'WIND'|'RAIN'|'DROUGHT';from:string;to:string};
export function simulationImpact(m:Mission,event:Simulation,date:string){
 if(date<event.from||date>event.to)return false;
 if(event.kind==='DROUGHT')return false;
 const window=(m as Mission&{planningWindow?:{windLimitMs?:number;rainSensitive?:boolean}}).planningWindow;
 // The injection is 9 m/s, not a real measurement. Use operation tolerances
 // when present; keep legacy identification only for older input records.
 if(event.kind==='WIND')return window?.windLimitMs!==undefined?9>=window.windLimitMs:/드론/.test(m.label)||m.resourceId?.includes('DR')===true;
 return window?.rainSensitive??(!!m.resourceId||!/상담|정산|자재/.test(m.label));
}
