import {it,expect,vi} from 'vitest';
import {createKmaReader,observationBase,parseObservation,normalizeKmaKey} from '../lib/kma';
const now=new Date('2026-09-08T00:20:00Z'),grid={nx:60,ny:127},base=observationBase(now);
const payload=(value='2.3')=>({response:{header:{resultCode:'00'},body:{items:{item:[{baseDate:base.date,baseTime:base.time,...grid,category:'WSD',obsrValue:value}]}}}});
it('encodes portal keys exactly once and preserves plus characters',async()=>{
 for(const key of ['a+b/c==','a%2Bb%2Fc%3D%3D']){
  const f=vi.fn(async(url:URL|string|Request)=>{expect(new URL(String(url)).searchParams.get('serviceKey')).toBe('a+b/c==');return new Response(JSON.stringify(payload()))});
  expect((await createKmaReader(f,()=>now)({key,nx:'60',ny:'127'})).status).toBe('READY');
 }
 expect(normalizeKmaKey(' a+b/c== ')).toBe('a+b/c==');
});
it('rejects malformed encoding without a network call or secret disclosure',async()=>{
 const f=vi.fn();const result=await createKmaReader(f,()=>now)({key:'private%zz',nx:'60',ny:'127'});
 expect(result.status).toBe('UNAVAILABLE');expect(f).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('private');
});
it('uses the previous KST hour across midnight',()=>{expect(observationBase(new Date('2026-09-07T15:10:00Z'))).toEqual({date:'20260907',time:'2300'})});
it('does not fetch without complete server configuration',async()=>{const f=vi.fn();expect((await createKmaReader(f,()=>now)({})).status).toBe('NOT_CONFIGURED');expect(f).not.toHaveBeenCalled()});
it('keeps missing values null and validates location and date',()=>{const r=parseObservation(payload(),grid,base,now);expect(r.windMs).toBe(2.3);expect(r.temperatureC).toBeNull();expect(()=>parseObservation(payload(),{nx:61,ny:127},base,now)).toThrow();expect(()=>parseObservation(payload('-999'),grid,base,now)).toThrow()});
it('deduplicates concurrent requests and caches results without exposing keys',async()=>{const f=vi.fn(async()=>new Response(JSON.stringify(payload())));const read=createKmaReader(f,()=>now),c={key:'test-secret',nx:'60',ny:'127'};const results=await Promise.all([read(c),read(c)]);await read(c);expect(f).toHaveBeenCalledTimes(1);expect(results[0].status).toBe('READY');expect(JSON.stringify(results)).not.toContain('test-secret')});
it('sanitizes provider failures and negative-caches errors',async()=>{const f=vi.fn(async()=>{throw Error('secret URL')});const read=createKmaReader(f,()=>now),c={key:'secret',nx:'60',ny:'127'};expect((await read(c)).status).toBe('UNAVAILABLE');expect(JSON.stringify(await read(c))).not.toContain('secret');expect(f).toHaveBeenCalledTimes(1)});
it('rejects stale data and duplicate category values',()=>{expect(()=>parseObservation(payload(),grid,base,new Date(now.getTime()+3*3600000))).toThrow();const p=payload();p.response.body.items.item.push({...p.response.body.items.item[0]});expect(()=>parseObservation(p,grid,base,now)).toThrow()});
