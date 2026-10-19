import {it,expect} from 'vitest';
import {repairLegacyResourceLinks} from '../lib/legacy-resource-links';
import {demoResourceState,registeredDemo} from '../lib/registered-demo';
import {centerDemoBatch} from '../lib/center-demo-fixture';
import {emptyCenter} from '../lib/center-registry';
import {resourceCandidates} from '../lib/replan-resource-options';
import {replanResolutionNeeds} from '../lib/replan-resolution';
import {makeContract,dateSlot} from '../lib/annual-replanning';
import type {State} from '../lib/types';

function fixture(){
 const s=registeredDemo(Array.from({length:30},(_,i)=>({pnu:String(5274000000000000000n+BigInt(i)),address:'격리 검증',area:1000,land:'답',source:'SYNTHETIC_TEST_INPUT' as const}))).state;
 const originals=new Map(s.missions.map(m=>[m.id,structuredClone(m)]));
 for(const m of s.machines)delete m.compatibleCrops;
 for(const m of s.missions)delete m.planningWindow;
 return {s,originals};
}
it('connects known demo compatibility and original future windows without changing dates, quantities or past records',()=>{
 const {s,originals}=fixture(),before=structuredClone(s),r=repairLegacyResourceLinks(s,'demo','2026-10-11',originals);
 expect(r.machines).toHaveLength(16);expect(r.windows.length).toBeGreaterThan(0);
 expect(r.state.missions.filter(m=>m.scheduledDate!<'2026-10-11')).toEqual(before.missions.filter(m=>m.scheduledDate!<'2026-10-11'));
 for(const m of r.state.missions){const {planningWindow,...rest}=m;expect(rest).toEqual(before.missions.find(b=>b.id===m.id));}
 const task=r.state.missions.find(m=>m.label==='벼 수확'&&m.resourceId==='JB23CB01'&&m.scheduledDate!>='2026-10-11')!;
 expect(resourceCandidates(r.state,task).map(r=>r.machine?.id)).toEqual(['JB23CB01','JB23CB02']);
 const repeat=repairLegacyResourceLinks(r.state,'demo','2026-10-11',originals);expect(repeat.machines).toEqual([]);expect(repeat.windows).toEqual([]);expect(s).toEqual(before);
});
it('keeps recorded crop restrictions and does not infer real or unrelated resource capabilities',()=>{
 const {s,originals}=fixture();s.machines[0].compatibleCrops=[];s.machines.push({...s.machines[1],id:'JB23TR03'});
 const r=repairLegacyResourceLinks(s,'demo','2026-10-11',originals);
 expect(r.state.machines[0].compatibleCrops).toEqual([]);expect(r.state.machines.at(-1)?.compatibleCrops).toBeUndefined();
 s.ruleVersion='ACTUAL';expect(repairLegacyResourceLinks(s,'demo','2026-10-11',originals).state).toEqual(s);
});
it('connects other-center demo resources only with their batch and never overwrites declared compatibility',()=>{
 const s:State={...emptyCenter('janggye'),demoResourceBatchId:centerDemoBatch,machines:[{...demoResourceState().machines.find(m=>m.id==='JB23CB01')!,id:'JSJGCB01',ownerCenterId:'janggye'}]};
 delete s.machines[0].compatibleCrops;
 expect(repairLegacyResourceLinks(s,'janggye','2026-10-11',new Map()).state.machines[0].compatibleCrops).toEqual(['rice']);
 delete s.demoResourceBatchId;expect(repairLegacyResourceLinks(s,'janggye','2026-10-11',new Map()).machines).toEqual([]);
});
it('displays the recorded work window even when the failed machine has zero allowed days, without offering manual conversion',()=>{
 const {s,originals}=fixture(),r=repairLegacyResourceLinks(s,'demo','2026-10-11',originals);
 const task=r.state.missions.find(m=>m.label==='벼 수확'&&m.resourceId==='JB23CB01'&&m.scheduledDate==='2026-10-11')!;
 const result=replanResolutionNeeds(r.state,{ids:[task.id],outage:{machineId:task.resourceId!,from:'2026-10-11',returnOn:'2026-11-01'}},{status:'UNAVAILABLE',points:[],kind:'short',sourceUrl:'',fetchedAt:''},'2026-10-11');
 expect(result[0]).toMatchObject({from:'2026-10-11',to:task.planningWindow!.to,people:null,minutes:null});
 expect(result[0].steps).not.toContain('MANUAL');expect(result[0].note).not.toContain('인력 대체');
});
it('keeps each repair-affected task original date as its target rather than pulling all work to tomorrow',()=>{
 const {s,originals}=fixture(),r=repairLegacyResourceLinks(s,'demo','2026-10-11',originals);
 const task=r.state.missions.find(m=>m.label==='벼 수확'&&m.resourceId==='JB23CB01'&&m.scheduledDate==='2026-10-13')!;
 const {contract}=makeContract(r.state,{ids:[task.id],deferAfter:'2026-10-11',outage:{machineId:task.resourceId!,from:'2026-10-13',returnOn:'2026-10-14'},scope:'PRESERVE'},{status:'UNAVAILABLE',points:[],kind:'short',sourceUrl:'',fetchedAt:''},'2026-10-11');
 expect(contract.tasks.find(m=>m.id===task.id)?.preferred).toBe(dateSlot('2026-10-13')/32);
});
