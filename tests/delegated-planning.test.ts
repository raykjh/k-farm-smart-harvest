import {it,expect} from 'vitest';
import {delegatedProposal,validateSettings} from '../lib/delegated-planning';
import {registeredDemo} from './registered-demo-fixture';
import {emptyConditions} from '../lib/field-conditions';
import type {FieldEntry} from '../lib/field-record';
const settings=validateSettings({start:'2026-09-18',end:'2026-11-30',context:{region:'계북면',operations:{rice:Object.fromEntries(['seed','nursery','soil','plant'].map(code=>[code,{from:'2026-09-19',to:'2026-09-28',laborMinutesPer1000m2:30}]))}}});
const field=(n:number):FieldEntry=>({pnu:'527403602311093000'+n,address:'검증 '+n,area:1000,crop:'',mode:'full',group:'',rights:'pending',consultationId:'10000000-0000-4000-8000-00000000000'+n,conditions:{...emptyConditions(),region:'계북면',landUse:'paddy',water:'yes',machineAccess:'yes',laborAvailable:'yes',climate:{rice:'suitable',potato:'unsuitable',pepper:'unsuitable'},evidence:'가상 검증',checkedOn:'2026-09-01'}});
const state=()=>({...registeredDemo().state,fields:[],missions:[]});
const id=(pnu:string)=>'20000000-0000-4000-8000-'+pnu.slice(-12);
it('automatically selects rice for two delegated fields and shares capacity without altering input',async ()=>{
 const s=state(),p=(await delegatedProposal([field(1),field(2)],1,s,[],settings,id,'2026-09-18'));
 expect(p.plans).toHaveLength(2);expect(p.assigned).toBe(8);expect(p.plans.every(x=>x.cultivation.crop==='rice')).toBe(true);expect(s.missions).toHaveLength(0);
 expect(p.demand[0].personMinutes).toBeGreaterThan(0);expect(p.demand[0].staffPeak).toBeLessThanOrEqual(s.staffCount);
 const tasks=p.state.missions;for(let i=0;i<tasks.length;i++)for(let j=i+1;j<tasks.length;j++)if(tasks[i].resourceId&&tasks[i].resourceId===tasks[j].resourceId)expect(tasks[i].start+tasks[i].duration<=tasks[j].start||tasks[j].start+tasks[j].duration<=tasks[i].start).toBe(true);
});
it('does not infer missing conditions, include joint fields or double-book existing cultivation',async ()=>{
 const f=field(1),p=(await delegatedProposal([{...f,conditions:undefined},{...field(2),mode:'joint'}],1,state(),[],settings,id,'2026-09-18'));expect(p.assigned).toBe(0);expect(p.pending).toHaveLength(1);
 const existing={id:id(f.pnu),pnu:f.pnu,crop:'rice' as const,start:settings.start,end:settings.end,source:'REGISTERED' as const};
 expect((await delegatedProposal([f],1,state(),[existing],settings,id,'2026-09-18')).assigned).toBe(0);
});
it('blocks inaccessible machinery and leaves missing work windows pending',async ()=>{
 const f=field(1);f.conditions!.machineAccess='no';expect((await delegatedProposal([f],1,state(),[],settings,id,'2026-09-18')).assigned).toBe(0);
 expect((await delegatedProposal([field(1)],1,state(),[],{...settings,context:{region:'계북면'}},id,'2026-09-18')).assigned).toBe(0);
 const p=(await delegatedProposal([field(1)],1,state(),[],settings,id,'2026-09-18'));expect(p.unassigned).toBe(6);expect(p.approvalBlocked).toBe(true);
});
it('requires planting through harvest and finishing capacity before batch approval',async ()=>{
 const context={region:'계북면',operations:{rice:Object.fromEntries(['seed','nursery','soil','plant','harvest','finish'].map(code=>[code,{from:'2026-09-19',to:'2026-09-28',laborMinutesPer1000m2:30}]))}};
 const p=(await delegatedProposal([field(1)],1,state(),[],{...settings,context},id,'2026-09-18'));
 expect(p.approvalBlocked).toBe(false);expect(p.plans[0].dispatch.feasibility[0].status).toBe('CAPACITY_FEASIBLE');
 const missing={...context,operations:{rice:{...context.operations.rice,harvest:{from:'2026-09-19',to:'2026-09-19',laborMinutesPer1000m2:30}}}};
 const s=state();s.machines=s.machines.filter(m=>!m.id.includes('CB'));
 expect((await delegatedProposal([field(1)],1,s,[],{...settings,context:missing},id,'2026-09-18')).approvalBlocked).toBe(true);
});
it('rejects invalid or excessively wide planning periods',()=>{
 expect(()=>validateSettings({...settings,start:'2026-02-30'})).toThrow();expect(()=>validateSettings({...settings,end:'2030-01-01'})).toThrow();
});
it('prefers a fully feasible local plan over unnecessary neighbor borrowing',async ()=>{
 const s=state();s.machines=s.machines.map(m=>({...m,ownerCenterId:'gyebuk'}));
 const tractor=s.machines.find(m=>m.id.includes('TR'))!;
 s.machines.unshift({...tractor,id:'JB24TR01',ownerCenterId:'gyenam'});
 s.centerSharing={centerId:'gyebuk',neighborCenterIds:['gyenam'],loans:[{id:'loan',machineId:'JB24TR01',ownerCenterId:'gyenam',borrowerCenterId:'gyebuk',usableFrom:'2026-09-19',usableUntil:'2026-09-28',status:'CONFIRMED',operatorConfirmed:true,transportConfirmed:true}]};
 const context={region:'계북면',operations:{rice:Object.fromEntries(['seed','nursery','soil','plant','harvest','finish'].map(code=>[code,{from:'2026-09-19',to:'2026-09-28',laborMinutesPer1000m2:30}]))}};
 const p=(await delegatedProposal([field(1)],1,s,[],{...settings,context},id,'2026-09-18'));
 expect(p.approvalBlocked).toBe(false);expect(p.comparisons[0].resourceAlternatives).toHaveLength(2);
 // Shared scope permits a confirmed loan; it does not force unnecessary use.
 expect(p.comparisons[0].resourceAlternatives?.[1].metrics.sharedMachineIds).toEqual([]);
 expect(p.plans[0].dispatch.assignments.some(a=>a.machineId==='JB24TR01')).toBe(false);
});
