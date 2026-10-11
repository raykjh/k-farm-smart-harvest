import {it,expect} from 'vitest';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {registeredDemo} from './registered-demo-fixture';
import type {AnnualPlan} from '../lib/annual-plan';
import type {Mission} from '../lib/types';
const plan={year:2026,plots:[{pnu:'new',area:1000,crop:'rice',mode:'full',tasks:[{id:'new-task',operationKey:'new-op',predecessorKeys:[],window:{from:'2026-10-01',to:'2026-10-01'},requirements:{machineCode:'TR',staff:1,transport:1,setupMinutes:0}}]}]} as unknown as AnnualPlan;
const existing=(resourceId:string,staff=1):Mission=>({id:'existing',fieldId:'other',scheduledDate:'2026-10-01',start:0,duration:32,status:'PLANNED',resourceId,staff,transport:1,owner:'장비'} as Mission);
const state=()=>({...registeredDemo().state,staffCount:2,transportCount:2,missions:[],machines:[{id:'TR-1',name:'test',type:'tractor',status:'AVAILABLE' as const,safetyLock:false,capacityHaHour:1}]});
it('allows parallel unrelated equipment while preserving the saved booking',async ()=>{
 const s={...state(),missions:[existing('OTHER')]},before=JSON.stringify(s);
 expect((await previewAnnualDispatch(plan,s,'2026-09-20')).assignments[0]?.startMinute).toBe(480);expect(JSON.stringify(s)).toBe(before);
});
it('never reserves a date in the gap between environment-qualified windows',async ()=>{
 const p=structuredClone(plan);p.plots[0].tasks[0].window={from:'2026-10-01',to:'2026-10-03',basis:'ENVIRONMENT_NORMAL_CANDIDATE'};
 p.plots[0].tasks[0].allowedWindows=[{from:'2026-10-01',to:'2026-10-01'},{from:'2026-10-03',to:'2026-10-03'}];
 const s={...state(),missions:[existing('TR-1')]};
 expect((await previewAnnualDispatch(p,s,'2026-09-20')).assignments[0]?.date).toBe('2026-10-03');
 s.machines=[];expect((await previewAnnualDispatch(p,s,'2026-09-20')).assignments).toHaveLength(0);
});
it('still blocks shared machine, staff, transport and field conflicts',async ()=>{
 const s=state();
 for(const next of [{...s,missions:[existing('TR-1')]},{...s,missions:[existing('OTHER',2)]},{...s,transportCount:1,missions:[existing('OTHER')]},{...s,missions:[{...existing('OTHER'),fieldId:'new'}]}])expect((await previewAnnualDispatch(plan,next,'2026-09-20')).assignments).toHaveLength(0);
});
it('releases cancelled capacity but never regenerates a cancelled operation or completes a cancelled prerequisite',async ()=>{
 const s={...state(),missions:[{...existing('TR-1'),status:'CANCELLED' as const}]};
 expect((await previewAnnualDispatch(plan,s,'2026-09-20')).assignments).toHaveLength(1);
 const cancelled={...s.missions[0],id:'new-task',fieldId:'new',operationKey:'new-op'};
 expect((await previewAnnualDispatch(plan,{...s,missions:[cancelled]},'2026-09-20')).assignments).toHaveLength(0);
 const dependent=structuredClone(plan);dependent.plots[0].tasks[0].predecessorKeys=['cancelled-op'];
 expect((await previewAnnualDispatch(dependent,{...s,missions:[{...s.missions[0],fieldId:'new',operationKey:'cancelled-op'} as Mission]},'2026-09-20')).assignments).toHaveLength(0);
});
