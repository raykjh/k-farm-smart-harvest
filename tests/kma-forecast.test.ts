import {it,expect,vi} from 'vitest';
import {forecastBase,parseForecast,createForecastReader} from '../lib/kma-forecast';
const now=new Date('2026-09-08T00:20:00Z'),grid={nx:72,ny:88},base=forecastBase('ultra',now);
const payload=()=>({response:{header:{resultCode:'00'},body:{totalCount:1,items:{item:[{baseDate:base.date,baseTime:base.time,...grid,fcstDate:'20260908',fcstTime:'1000',category:'WSD',fcstValue:'0'}]}}}});
it('rolls publication dates over KST midnight conservatively',()=>{
 expect(forecastBase('ultra',now)).toEqual({date:'20260908',time:'0830'});
 expect(forecastBase('short',now)).toEqual({date:'20260908',time:'0800'});
 expect(forecastBase('short',new Date('2026-09-07T15:30:00Z'))).toEqual({date:'20260907',time:'2300'});
 expect(forecastBase('ultra',new Date('2026-09-07T15:20:00Z'))).toEqual({date:'20260907',time:'2330'});
});
it('preserves zero and missing data separately',()=>{const r=parseForecast(payload(),'ultra',grid,base,now);expect(r.points[0].windMs).toBe(0);expect(r.points[0].temperatureC).toBeNull();expect(r.points[0].rainProbabilityPercent).toBeNull()});
it('retains same-hour ultra provider base separately from requested issuance',()=>{const p=payload();p.response.body.items.item[0].baseTime='0800';const r=parseForecast(p,'ultra',grid,base,now);expect(r.issuedAt).toContain('08:00');expect(r.requestedBaseAt).toContain('08:30')});
it('rejects location, time, truncation, duplicate and stale run errors',()=>{
 expect(()=>parseForecast(payload(),'ultra',{nx:1,ny:1},base,now)).toThrow();
 for(const mutate of [(p:ReturnType<typeof payload>)=>p.response.body.totalCount=2,(p:ReturnType<typeof payload>)=>p.response.body.items.item[0].fcstDate='20260230',(p:ReturnType<typeof payload>)=>p.response.body.items.item[0].baseTime='0030']){const p=payload();mutate(p);expect(()=>parseForecast(p,'ultra',grid,base,now)).toThrow()}
 const p=payload();p.response.body.items.item.push({...p.response.body.items.item[0]});p.response.body.totalCount=2;expect(()=>parseForecast(p,'ultra',grid,base,now)).toThrow();
 expect(()=>parseForecast(payload(),'ultra',grid,base,new Date(now.getTime()+4*3600000))).toThrow();
});
it('coalesces requests, encodes once, caches and sanitizes errors',async()=>{
 const f=vi.fn(async(url:URL|string|Request)=>{expect(new URL(String(url)).searchParams.get('serviceKey')).toBe('a+b=');return new Response(JSON.stringify(payload()))});
 const read=createForecastReader('ultra',f,()=>now),c={key:'a%2Bb%3D',nx:'72',ny:'88'};
 expect((await Promise.all([read(c),read(c)]))[0].status).toBe('READY');await read(c);expect(f).toHaveBeenCalledTimes(1);
 const bad=vi.fn(async()=>{throw Error('secret')});const fail=createForecastReader('short',bad,()=>now);expect(JSON.stringify(await fail(c))).not.toContain('secret');await fail(c);expect(bad).toHaveBeenCalledTimes(1);
 const empty=vi.fn();expect((await createForecastReader('short',empty)({})).status).toBe('NOT_CONFIGURED');expect(empty).not.toHaveBeenCalled();
});
