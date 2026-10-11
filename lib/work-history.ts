import type {Mission} from './types';
export type HourObservation={observedAt:string;precipitationMm:number|null;windMs:number|null;temperatureC:number|null;quality:{temperature:string;precipitation:string;wind:string}};
export function simulateHourlyTask(m:Mission,rows:HourObservation[],today:string){
 const startMinute=480+((m.start%32)+32)%32*15,endMinute=startMinute+m.duration*15;
 const base={source:'DEMO_SIMULATION',simulatedStartedAt:null as string|null,simulatedFinishedAt:null as string|null};
 if(m.status==='CANCELLED'||!m.scheduledDate||m.scheduledDate>=today)return {...base,status:'NOT_DUE'};
 if(!Number.isInteger(m.duration)||m.duration<=0||endMinute>1440)return {...base,status:'NEEDS_REVIEW'};
 // User-approved demo assumption: blank rain on an existing valid row is dry.
 // Never mutate observations or apply this interpretation to production records.
 const hours=[];for(let h=Math.floor(startMinute/60);h<=Math.ceil(endMinute/60);h++)hours.push(h);
 const points=hours.map(h=>rows.find(r=>r.observedAt.startsWith(m.scheduledDate+'T'+String(h).padStart(2,'0')+':00')));
 if(points.some(r=>!r))return {...base,status:'NEEDS_OBSERVATION'};
 const valid=points as HourObservation[];
 if(valid.some(r=>Object.values(r.quality).some(v=>v==='1'||v==='9')))return {...base,status:'NEEDS_OBSERVATION'};
 if(valid.some(r=>m.windLimitMs!==undefined&&r.windMs!==null&&r.windMs>=m.windLimitMs))return {...base,status:'SIMULATED_HELD'};
 // Explicit conservative demo rule, not an agronomic threshold for production.
 if(valid.some(r=>r.precipitationMm!==null&&r.precipitationMm>0))return {...base,status:'SIMULATED_HELD'};
 if(valid.some(r=>r.windMs===null||r.temperatureC===null))return {...base,status:'NEEDS_OBSERVATION'};
 const stamp=(v:number)=>m.scheduledDate+'T'+String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0')+':00+09:00';
 return {...base,status:'SIMULATED_COMPLETED',simulatedStartedAt:stamp(startMinute),simulatedFinishedAt:stamp(endMinute)};
}
export type DailyObservation={date:string;precipitationMm:number|null;maxWindMs:number|null};
// A simulation assessment is not evidence of real execution or safe conditions.
export function assessHistoricalTask(m:Mission,observation:DailyObservation|undefined,today:string){
 if(m.status==='CANCELLED'||!m.scheduledDate||m.scheduledDate>=today)return {status:'NOT_DUE',reason:'No past execution generated'};
 if(!observation||observation.date!==m.scheduledDate)return {status:'NEEDS_OBSERVATION',reason:'Missing daily observation'};
 if(observation.precipitationMm===null||observation.maxWindMs===null)return {status:'NEEDS_OBSERVATION',reason:'Incomplete observation; missing is not zero'};
 if(m.windLimitMs!==undefined&&observation.maxWindMs>=m.windLimitMs)return {status:'SIMULATED_HELD',reason:'Daily maximum exceeds configured wind limit; time of impact unknown'};
 if(observation.precipitationMm>0)return {status:'NEEDS_HOURLY_REVIEW',reason:'Daily rainfall cannot establish conditions at planned work time'};
 return {status:'SIMULATION_CANDIDATE',reason:'Daily weather screening only; resources and field conditions still require validation'};
}
