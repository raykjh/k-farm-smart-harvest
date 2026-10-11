import {it,expect} from 'vitest';
import {inWorkspace,centerId,receiptId,parseWorkspace} from '../lib/workspace';
it('isolates concurrent workspace contexts',async()=>{
 const results=await Promise.all(['operations','sandbox'].map(w=>inWorkspace(parseWorkspace(w),async()=>{await Promise.resolve();return [centerId(),receiptId('same')]})));
 expect(results).toEqual([['demo','same'],['demo','same']]);
});
it('rejects untrusted workspace names',()=>expect(()=>parseWorkspace('another')).toThrow());
