import {it,expect} from 'vitest';
import {makeContract,verifyAssignments} from '../lib/annual-replanning';
import {registeredDemo} from './registered-demo-fixture';
const weather={status:'NOT_CONFIGURED',kind:'short',sourceUrl:'test',fetchedAt:'2026-09-10',points:[]} as const;
it('uses crop operation windows, keeps assumptions visible, and selects a daily batch',()=>{
 const s=registeredDemo().state,ids=s.missions.filter(m=>m.scheduledDate==='2026-09-10'&&m.status!=='COMPLETED').map(m=>m.id);
 const r=makeContract(s,{ids,day:'2026-09-10'},weather as any,'2026-09-10');
 expect(r.contract.daily).toBe(true);expect(r.contract.tasks.filter(t=>t.selected)).toHaveLength(ids.length);
 expect(r.warnings.length).toBeGreaterThan(0);
 expect(()=>makeContract(s,{ids,day:'2026-09-11'},weather as any,'2026-09-10')).toThrow();
});
it('independent verification refuses frozen changes and duplicate assignments',()=>{
 const c={tasks:[{id:'a',field:'parcel',original:32,duration:4,allowed:[32,64],resource:'M',person:null,staff:1,transport:1,selected:false,preferred:null,predecessor:null}],freezeBefore:96,staffCapacity:2,transportCapacity:2,daily:false};
 expect(()=>verifyAssignments(c,[{id:'a',start:64}],'REBUILD_RELATED')).toThrow('단기');
 expect(()=>verifyAssignments(c,[{id:'a',start:32},{id:'a',start:32}],'GAPS_ONLY')).toThrow();
});
it('uses forecast wind thresholds per task instead of stopping every ground task',()=>{
 const s=registeredDemo().state;s.missions=[];s.fields=s.fields.slice(0,2);
 const date='2026-09-11';
 s.missions=s.fields.map((f,i)=>({id:f.id+'-1',fieldId:f.id,label:'기상 검증',crop:'쌀',scheduledDate:date,month:9,owner:'장비',status:'PLANNED',resourceId:i?'JB23TR01':'JB23DR01',start:64,duration:4,deadline:96,priority:5,batchKey:'test',staff:1,transport:1,planningWindow:{from:date,to:date,duration:4,windLimitMs:i?12:5,rainSensitive:true,basis:'CONFIRMED'}})) as any;
 const w={...weather,status:'READY',points:Array.from({length:8},(_,i)=>({at:date+'T'+String(i+8).padStart(2,'0')+':00:00+09:00',windMs:9,precipitation:'강수없음'}))};
 const c=makeContract(s,{ids:[s.missions[0].id],preferred:date},w as any,'2026-09-10').contract;
 expect(c.tasks.find(t=>t.resource==='JB23DR01')!.allowed).toHaveLength(0);expect(c.tasks.find(t=>t.resource==='JB23TR01')!.allowed.length).toBeGreaterThan(0);
});
