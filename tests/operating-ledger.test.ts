import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {effectiveEntries,forecastRows,summarizeActual,summarizeForecast,ledgerInput,type OperatingEntry} from '../lib/operating-ledger';
import {emptyCenter} from '../lib/center-registry';
const field='5274036023900010001';
const entry=(patch:Partial<OperatingEntry>={}):OperatingEntry=>({id:randomUUID(),supersedesId:null,voided:false,kind:'SHIPMENT',cultivationId:randomUUID(),date:'2026-10-15',missionId:null,commodity:'건고추',quantityKg:100,amountWon:200000,memo:'출하 확인',fieldId:field,address:'가상농지',areaM2:1000,crop:'고추',source:'SIMULATED',task:null,actor:'담당자',at:'2026-10-16T00:00:00Z',requestHash:'h',...patch});
it('keeps originals but aggregates only the active correction, including explicit voids',()=>{
 const a=entry(),b=entry({supersedesId:a.id,quantityKg:90}),c=entry({supersedesId:b.id,voided:true});
 expect(effectiveEntries([a,b])).toEqual([b]);expect(effectiveEntries([a,b,c])).toEqual([]);
});
it('separates shipment commodities, missing amounts, data sources and cashflow years',()=>{
 const a=entry(),b=entry({commodity:'생고추',quantityKg:300,amountWon:null}),cost=entry({kind:'WORK_COST',missionId:'m',quantityKg:null,amountWon:50000}),payment=entry({kind:'OWNER_PAYMENT',quantityKg:null,amountWon:100000});
 const result=summarizeActual([a,b,cost,payment,entry({source:'ACTUAL'})],2026,'SIMULATED');
 expect(result.fieldCount).toBe(1);expect(result.areaM2).toBe(1000);expect(result.groups[0].quantities).toHaveLength(2);expect(result.groups[0].balance).toBeNull();
 expect(summarizeActual([a,cost,payment],2026,'SIMULATED').groups[0].balance).toBe(50000);
 expect(summarizeActual([a,cost,payment],2027,'SIMULATED').rows).toHaveLength(0);
});
it('does not turn missing expenses or owner payments into zero',()=>{
 const s=summarizeActual([entry()],2026,'SIMULATED').groups[0];expect(s.expense).toBeNull();expect(s.ownerPaid).toBeNull();expect(s.balance).toBeNull();
});
it('combines registered records without a source selector while retaining provenance and corrections',()=>{
 const a=entry(),b=entry({source:'ACTUAL',fieldId:'another',areaM2:500,quantityKg:50}),correction=entry({...a,id:randomUUID(),supersedesId:a.id,quantityKg:90});
 const inputs=[a,b,correction,entry({date:'2025-10-15'})],before=structuredClone(inputs);
 const result=summarizeActual(inputs,2026);
 expect(result.fieldCount).toBe(2);expect(result.areaM2).toBe(1500);
 expect(result.groups[0].quantities).toEqual([{commodity:'건고추',kg:140}]);
 expect(new Set(result.rows.map(r=>r.source))).toEqual(new Set(['ACTUAL','SIMULATED']));
 expect(inputs).toEqual(before);
});
it('counts a field once while retaining successive crops and never multiplies yields by tasks',()=>{
 const state=emptyCenter('demo');state.fields=[{id:field,area:1000,address:'가상',source:'DEMO_ASSUMPTION'} as any];
 const a={id:randomUUID(),pnu:field,crop:'potato',start:'2026-03-01',end:'2026-06-30',source:'REGISTERED'},b={...a,id:randomUUID(),crop:'rice',start:'2026-07-01',end:'2026-10-31'};
 const plans=[{plots:[{cultivationId:a.id,pnu:field,crop:'potato',area:1000,referenceId:'potato-spring',yieldRange:{low:2000,high:2500},tasks:Array(10).fill({})}]},{plots:[{cultivationId:b.id,pnu:field,crop:'rice',area:1000,referenceId:'rice-paddy',yieldRange:{low:500,high:550},tasks:Array(20).fill({})}]}];
 const rows=forecastRows(state,[a,b] as any,plans as any,2026),report=summarizeForecast(rows);
 expect(report.fieldCount).toBe(1);expect(report.cropCount).toBe(2);expect(report.areaM2).toBe(1000);expect(report.groups[0].production?.low).toBe(2000);
 expect(forecastRows(state,[{...a,closedAt:'2026-04-01'}] as any,plans as any,2026)).toEqual([]);
 expect(forecastRows(state,[{...a,end:'2027-01-01'}] as any,plans as any,2026)[0].yieldRange).toBeNull();
});
it('requires work association for costs and explicit commodity and mass for shipments',()=>{
 const {fieldId,address,areaM2,crop,source,task,actor,at,requestHash,...input}=entry();
 expect(ledgerInput.parse(input).quantityKg).toBe(100);
 expect(()=>ledgerInput.parse({...input,quantityKg:null})).toThrow();expect(()=>ledgerInput.parse({...input,kind:'WORK_COST',quantityKg:null})).toThrow();
});
