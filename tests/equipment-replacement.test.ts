import {it,expect} from 'vitest';
import {registeredDemo} from './registered-demo-fixture';
import {makeContract,slotDate,verifyAssignments,calculateAnnualReplan} from '../lib/annual-replanning';
import {replacementFor,type EquipmentReplacement} from '../lib/equipment-replacement';
const weather={status:'NOT_CONFIGURED',kind:'short',sourceUrl:'test',points:[]} as any;
function fixture(){
 const s=registeredDemo().state;
 const old=s.machines.find(m=>m.id==='JB23DR01')!;old.status='MAINTENANCE';
 const next={...old,id:'LOAN-DR',status:'AVAILABLE' as const};s.machines.push(next);
 const m={...s.missions.find(m=>m.resourceId===old.id)!,id:'test-drone',scheduledDate:'2026-09-18',start:0,status:'PLANNED' as const,duration:4,predecessorMissionIds:[],planningWindow:{from:'2026-09-18',to:'2026-09-24',duration:4,windLimitMs:5,rainSensitive:true,basis:'OPERATOR_PROVISIONAL_WINDOW'}};
 s.missions=[m];
 const replacement:EquipmentReplacement={failedId:old.id,replacementId:next.id,availableFrom:'2026-09-20',availableUntil:'2026-09-23',arrivalConfirmed:true,compatibilityConfirmed:true,note:'isolated test: delivery and crew confirmed'};
 return {s,m,replacement};
}
it('only offers replacement slots inside confirmed availability and preserves input',()=>{
 const {s,m,replacement}=fixture(),before=JSON.stringify(s);
 const c=makeContract(s,{ids:[m.id],preferred:'2026-09-19',replacement},weather,'2026-09-18').contract;
 expect(c.tasks[0].resource).toBe('LOAN-DR');expect(c.tasks[0].allowed.length).toBeGreaterThan(0);
 expect(c.tasks[0].allowed.every(t=>slotDate(t)>='2026-09-20'&&slotDate(t)<='2026-09-23')).toBe(true);expect(JSON.stringify(s)).toBe(before);
});
it('rejects uncertain arrival, invalid productivity and safety bypass',()=>{
 const {s,m,replacement}=fixture();expect(()=>replacementFor(s,m,{...replacement,arrivalConfirmed:false})).toThrow('도착');
 s.machines.find(x=>x.id==='LOAN-DR')!.capacityHaHour=0;expect(()=>replacementFor(s,m,replacement)).toThrow('능률');
 s.machines.find(x=>x.id===replacement.failedId)!.safetyLock=true;expect(()=>replacementFor(s,m,replacement)).toThrow('안전잠금');
});
it('does not invent capacity beyond crop deadline and detects replacement reservations',()=>{
 const {s,m,replacement}=fixture();
 const none=makeContract(s,{ids:[m.id],preferred:'2026-09-20',replacement:{...replacement,availableFrom:'2026-09-25',availableUntil:undefined}},weather,'2026-09-18');expect(none.contract.tasks[0].allowed).toEqual([]);
 const c=makeContract(s,{ids:[m.id],preferred:'2026-09-20',replacement},weather,'2026-09-18').contract;
 c.tasks.push({...c.tasks[0],id:'reserved'});const start=c.tasks[0].allowed[0];expect(()=>verifyAssignments(c,[{id:m.id,start},{id:'reserved',start}],'REBUILD_RELATED')).toThrow('충돌');
});
it('real solver uses the arrival date and exposes resource-only changes',async()=>{
 const {s,m,replacement}=fixture();
 const result=await calculateAnnualReplan(s,{ids:[m.id],preferred:'2026-09-20',replacement},weather,'2026-09-18');
 expect(result.status).toBe('FEASIBLE');expect(result.diff[0].afterResource).toBe('LOAN-DR');expect(result.diff[0].date).toBe('2026-09-20');
});
