import {it,expect,vi} from 'vitest';
import {checkEnvironmentExecution} from '../lib/environment-execution-check';
import {assertEnvironmentReferences} from '../lib/environment-approval';
import type {ForecastResult} from '../lib/kma-forecast';
const review={reviewer:'test',checkedOn:'2026-09-20',validUntil:'2026-09-22',note:'fixture',ready:true};
const task={id:'t',operationCode:'plant',requirements:{windLimitMs:10,rainSensitive:true}};
const plan={plots:[{tasks:[task],environmental:{operations:[{code:'plant',rule:{metric:'meanTemperatureC',lowerC:15,upperC:25,consecutiveDays:1,minimumNightC:10}}]}}]};
const assignment=[{taskId:'t',date:'2026-09-21',startMinute:480,durationMinutes:60}];
const forecast:ForecastResult={status:'READY',kind:'short',sourceUrl:'https://example.org',fetchedAt:'2026-09-20T03:00:00Z',issuedAt:'2026-09-20T02:00:00Z',points:Array.from({length:24},(_,i)=>({at:`2026-09-21T${String(i).padStart(2,'0')}:00:00+09:00`,temperatureC:20,windMs:2,humidityPercent:50,rainProbabilityPercent:0,precipitation:'강수없음'}))};
const now=new Date('2026-09-20T03:00:00Z');
it('accepts current complete forecast and in-date readiness',()=>expect(()=>checkEnvironmentExecution(assignment,plan,forecast,review,now)).not.toThrow());
it('rejects stale forecast, unready growth and expired readiness',()=>{
 expect(()=>checkEnvironmentExecution(assignment,plan,{...forecast,issuedAt:'2026-09-19T02:00:00Z'},review,now)).toThrow('최신');
 expect(()=>checkEnvironmentExecution(assignment,plan,forecast,{...review,ready:false},now)).toThrow('생육');
 expect(()=>checkEnvironmentExecution(assignment,plan,forecast,{...review,validUntil:'2026-09-20'},now)).toThrow('유효기간');
});
it('rejects incomplete daily means, high wind and below-threshold temperatures',()=>{
 expect(()=>checkEnvironmentExecution(assignment,plan,{...forecast,points:forecast.points.slice(1)},review,now)).toThrow('온도');
 expect(()=>checkEnvironmentExecution(assignment,plan,{...forecast,points:forecast.points.map(p=>({...p,windMs:12}))},review,now)).toThrow('강풍');
 expect(()=>checkEnvironmentExecution(assignment,plan,{...forecast,points:forecast.points.map(p=>({...p,temperatureC:5}))},review,now)).toThrow('온도');
});
it('locks and checks exact profile and weather baseline revisions',async()=>{
 const p={plots:[{environmental:{standardId:'s',standardVersion:2,dataset:{id:'d',version:3}}}]} as any;
 const tx={$queryRaw:vi.fn().mockResolvedValueOnce([{version:2,payload:{status:'REVIEWED'}}]).mockResolvedValueOnce([{version:3}])};
 await expect(assertEnvironmentReferences(tx as any,p)).resolves.toBeUndefined();expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
 const stale={$queryRaw:vi.fn().mockResolvedValueOnce([{version:4,payload:{status:'REVIEWED'}}]).mockResolvedValueOnce([{version:3}])};await expect(assertEnvironmentReferences(stale as any,p)).rejects.toThrow('변경');
});
