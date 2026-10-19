import {expect,it,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
import {removeRegisteredDemo} from '../lib/registered-demo-storage';
import {fieldEntry,type FieldEntry} from '../lib/field-record';
import {emptyConditions} from '../lib/field-conditions';
import {DEMO_BATCH} from '../lib/registered-demo';

function fixture(change?:(field:FieldEntry)=>void){
 const field=fieldEntry.parse({pnu:'5274036023900000001',address:'합성검증리 9001',area:1000,crop:'rice',mode:'full',rights:'pending',group:'',
  conditions:{...emptyConditions(),landUse:'paddy',water:'yes',machineAccess:'yes',climate:{rice:'suitable',potato:'marginal',pepper:'unknown'}}});
 const saved=structuredClone(field);change?.(saved);
 const manual=fieldEntry.parse({pnu:'5274036023900000002',address:'합성검증리 9002',area:2000,crop:'potato',mode:'joint',rights:'pending',group:''});
 const consultation={id:'synthetic-consultation',payload:{farmer:{name:'가상 신청인',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},fields:[],consent:false,step:3}};
 const query=vi.fn().mockResolvedValueOnce([{kind:'demoManifest',id:DEMO_BATCH,version:1,payload:{fields:[field],consultations:[consultation],simulated:true}}])
  .mockResolvedValueOnce([{kind:'fields',id:'current',version:2,payload:[saved,manual]},
   {kind:'consultation',id:consultation.id,version:1,payload:consultation.payload}]);
 const execute=vi.fn().mockResolvedValue(1);
 return {tx:{$queryRaw:query,$executeRaw:execute} as unknown as Prisma.TransactionClient,execute,saved,manual};
}

it.each([
 ['nested crop suitability',(f:FieldEntry)=>{f.conditions!.climate.rice='marginal';}],
 ['nested irrigation availability',(f:FieldEntry)=>{f.conditions!.water='no';}],
 ['nested verification evidence',(f:FieldEntry)=>{f.conditions!.evidence='담당자 수정';}],
 ['nested equipment access',(f:FieldEntry)=>{f.conditions!.machineAccess='no';}],
] as const)('refuses demo removal after a %s edit before any data mutation',async(_label,change)=>{
 const f=fixture(change),before=structuredClone(f.saved);
 await expect(removeRegisteredDemo(f.tx)).rejects.toThrow('Edited demo field');
 expect(f.execute).toHaveBeenCalledTimes(1);
 expect(f.execute.mock.calls[0][0].join('')).toContain('pg_advisory_xact_lock');
 expect(f.saved).toEqual(before);
});

it('accepts equivalent nested key ordering while retaining unrelated field records',async()=>{
 const f=fixture(field=>{field.conditions={...field.conditions!,climate:{pepper:'unknown',potato:'marginal',rice:'suitable'}};});
 await removeRegisteredDemo(f.tx);
 const calls=f.execute.mock.calls;
 expect(calls.some(call=>call[0].join('').includes('removedDemoRecords'))).toBe(true);
 const update=calls.find(call=>call[0].join('').includes('UPDATE "WorkRecord"'))!;
 expect(update).toBeDefined();expect(JSON.parse(update[1])).toEqual([f.manual]);
 const removals=calls.filter(call=>call[0].join('').includes('DELETE FROM'));
 expect(removals).toHaveLength(2);
 expect(removals.some(call=>call.includes('synthetic-consultation'))).toBe(true);
 expect(removals.every(call=>!call.includes(f.manual.pnu))).toBe(true);
});
