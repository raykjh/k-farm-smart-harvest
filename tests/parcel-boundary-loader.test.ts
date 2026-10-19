import {it,expect,vi} from 'vitest';
import {loadParcelBoundaries} from '../lib/parcel-boundary-loader';
it('loads 300 boundaries in at most four concurrent requests, retaining order and failures',async()=>{
 let active=0,peak=0;const ids=Array.from({length:300},(_,i)=>String(i));
 const read=vi.fn(async(id:string)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;if(id==='25')throw Error('unavailable');return 'boundary-'+id});
 const result=await loadParcelBoundaries([...ids,'2'],read,new AbortController().signal,100);
 expect(peak).toBe(4);expect(read).toHaveBeenCalledTimes(300);expect(result.failed).toEqual(['25']);expect(result.items.map(i=>i.id)).toEqual(ids.filter(id=>id!=='25'));
});
it('starts no more external reads after the view is cancelled',async()=>{
 const abort=new AbortController(),read=vi.fn(async(id:string)=>{abort.abort();return id});
 const result=await loadParcelBoundaries(['1','2','3','4','5'],read,abort.signal);
 expect(read).toHaveBeenCalledOnce();expect(result.items).toEqual([]);expect(result.failed).toEqual([]);
});
