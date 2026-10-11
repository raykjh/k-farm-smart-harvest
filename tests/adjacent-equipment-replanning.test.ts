import {it,expect} from 'vitest';
import {directlyAdjacent} from '../lib/center-adjacency';
import {emptyCenter} from '../lib/center-registry';
import {makeContract,calculateAnnualReplan,dateSlot,slotDate,verifyAssignments} from '../lib/annual-replanning';
import {relatedReplanIds} from '../lib/replan-scope';
import {planningState} from '../lib/replan-history';
import type {Mission} from '../lib/types';
import type {SharingOffer} from '../lib/equipment-sharing-offers';
const rect=(x:number,y:number,w=1,h=1)=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
const weather={status:'NOT_CONFIGURED',kind:'short',sourceUrl:'test',points:[]} as any;
function fixture(){
 const s=emptyCenter('demo');s.staffCount=3;s.transportCount=2;
 s.machines=[{id:'OLD',ownerCenterId:'demo',name:'고장',type:'트랙터',capacityHaHour:1,status:'MAINTENANCE',safetyLock:false},...['LOCAL','NEIGHBOR','DISTANT'].map((id,i)=>({id,ownerCenterId:['demo','janggye','gyenam'][i],name:id,type:'트랙터',capacityHaHour:1,status:'AVAILABLE' as const,safetyLock:false}))];
 const offer=(id:string,ownerCenterId:string):SharingOffer=>({id,version:1,machineId:id,ownerCenterId,borrowerCenterId:'demo',from:'2027-05-01',to:'2027-05-07',compatibleMachineIds:['OLD'],outboundSlots:2,returnSlots:2,agreementRef:'fixture',conditions:'fixture confirmed compatibility/crew/transit',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true});
 s.centerSharing={centerId:'demo',neighborCenterIds:['janggye'],loans:[],offers:[offer('LOCAL','demo'),offer('NEIGHBOR','janggye'),offer('DISTANT','gyenam')],blocks:[],lendingDays:Array.from({length:7},(_,i)=>({ownerCenterId:'janggye',date:`2027-05-0${i+1}`,capacity:1}))};
 s.missions=[{id:'task',fieldId:'field',label:'경운',crop:'쌀',scheduledDate:'2027-05-02',start:2,duration:4,deadline:32,month:5,owner:'장비',status:'PLANNED',resourceId:'OLD',priority:1,batchKey:'test',staff:1,transport:1,predecessorMissionIds:[],planningWindow:{from:'2027-05-01',to:'2027-05-07',duration:4,windLimitMs:10,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'}} as Mission];return s;
}
it('requires a real common border, not corners, proximity or transitive neighbors',()=>{
 expect(directlyAdjacent(rect(0,0),rect(1,0))).toBe(true);expect(directlyAdjacent(rect(0,0),rect(1,1))).toBe(false);
 expect(directlyAdjacent(rect(0,0),rect(2,0))).toBe(false);expect(directlyAdjacent(undefined,rect(0,0))).toBe(false);
 expect(directlyAdjacent(rect(0,0,2),rect(0.5,1,0.5))).toBe(true);
});
it('uses authorized direct neighbors only and accounts for transit, lender jobs and safety',()=>{
 const s=fixture(),c=makeContract(s,{ids:['task'],scope:'PRESERVE'},weather,'2027-05-01').contract;
 expect(c.tasks[0].options!.map(o=>o.resource)).toEqual(['OLD','LOCAL','NEIGHBOR']);
 const loan=c.tasks[0].options!.find(o=>o.resource==='NEIGHBOR')!;expect(loan.allowed.every(t=>t%32>=2&&t%32+4<=30)).toBe(true);
 s.centerSharing!.blocks=[{machineId:'NEIGHBOR',date:'2027-05-02'}];
 const next=makeContract(s,{ids:['task']},weather,'2027-05-01').contract;expect(next.tasks[0].options!.find(o=>o.resource==='NEIGHBOR')!.allowed.some(t=>slotDate(t)==='2027-05-02')).toBe(false);
 s.machines[0].safetyLock=true;expect(makeContract(s,{ids:['task']},weather,'2027-05-01').contract.tasks[0].options).toHaveLength(1);
});
it('does not borrow equipment when the lending center has no operator/transport capacity',()=>{
 const s=fixture();s.centerSharing!.lendingDays!.forEach(d=>d.capacity=0);
 const c=makeContract(s,{ids:['task']},weather,'2027-05-01').contract;
 expect(c.tasks[0].options!.find(o=>o.resource==='NEIGHBOR')!.allowed).toEqual([]);
});
it('leaves unrelated distant records outside the calculation, even with an old capacity conflict',()=>{
 const s=fixture();s.missions.push({...s.missions[0],id:'december-1',scheduledDate:'2027-12-01',resourceId:null,staff:5},{...s.missions[0],id:'december-2',scheduledDate:'2027-12-01',resourceId:null,staff:5});
 const c=makeContract(s,{ids:['task'],scope:'PRESERVE'},weather,'2027-05-01').contract;
 expect(c.tasks.map(t=>t.id)).toEqual(['task']);expect(s.missions).toHaveLength(3);
});
it('real solver preserves dates with local substitutes then uses authorized neighbors',async()=>{
 const s=fixture();let r=await calculateAnnualReplan(s,{ids:['task'],scope:'PRESERVE'},weather,'2027-05-01');
 expect(r.diff[0]).toMatchObject({date:'2027-05-02',afterResource:'LOCAL'});
 s.machines.find(m=>m.id==='LOCAL')!.status='MAINTENANCE';r=await calculateAnnualReplan(s,{ids:['task'],scope:'PRESERVE'},weather,'2027-05-01');
 expect(r.diff[0]).toMatchObject({date:'2027-05-02',afterResource:'NEIGHBOR'});
 const c=makeContract(s,{ids:['task'],scope:'PRESERVE'},weather,'2027-05-01').contract;
 expect(()=>verifyAssignments(c,[{id:'task',start:dateSlot('2027-05-02')+2,resource:'DISTANT'}],'GAPS_ONLY')).toThrow('장비');
});
it('expands only connected conflicts and protects explicit locks and unrelated work',()=>{
 const s=fixture();s.missions.push({...s.missions[0],id:'related'},{...s.missions[0],id:'unrelated',resourceId:'DIFFERENT',staff:0,transport:0,owner:'농부',fieldId:'other'});
 expect([...relatedReplanIds(s,['task'],'2027-05-01')]).toEqual(['task','related']);
 (s.missions[1] as any).planningLocked=true;
 const c=makeContract(s,{ids:['task'],scope:'EXPAND'},weather,'2027-05-01').contract;
 expect(c.tasks.find(t=>t.id==='related')!.locked).toBe(true);
 expect(()=>makeContract(s,{ids:['related']},weather,'2027-05-01')).toThrow('잠금');
});
it('started execution evidence cannot be moved or replaced',()=>{
 const s=fixture(),state=planningState(s,[{missionId:'task',plannedDate:'2027-05-02',source:'ACTUAL',assessment:'HELD',actualStartedAt:'2027-05-02T08:00:00+09:00'}]);
 expect(()=>makeContract(state,{ids:['task']},weather,'2027-05-01')).toThrow('시작 전');
});
