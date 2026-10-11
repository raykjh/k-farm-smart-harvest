import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {centerRegistry} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
import {resetFourCenterFixture,fourCenterRegistration,fourCenterTestUrl,fixtureDay as day} from './four-center-fixture';
import type {State} from '../lib/types';

/** Both route and browser acceptance use identical inputs before intake. No
 * approved missions are seeded, and capacity is never raised after an incident. */
export async function resetModelFreeOperationsFixture(){
 if(process.env.DATABASE_URL!==fourCenterTestUrl||process.env.AI_MODE!=='demo')throw Error('Dedicated model-free DB required');
 await resetFourCenterFixture();
 for(const c of centerRegistry){
  const row=await db.center.findUniqueOrThrow({where:{id:c.id}}),s=row.state as unknown as State;
  // The lender has its own harvest and a spare operator, machine and vehicle.
  s.crewCapacity={operators:c.id==='janggye'?2:1,workers:c.id==='demo'?1:2};s.staffCount=s.crewCapacity.operators+s.crewCapacity.workers;
  if(c.id==='janggye')s.operatorRoster!.push({...s.operatorRoster![0],id:randomUUID(),name:'홍예비'});
  s.machines=s.machines.filter(m=>c.id!=='demo'||!m.id.endsWith('CB02'));
  s.machines.forEach(m=>{m.compatibleCrops=['rice'];if(m.id.includes('CB'))m.capacityHaHour=process.env.KFARM_COMPARISON_E2E==='1'?0.25:0.16});
  await db.center.update({where:{id:c.id},data:{state:JSON.parse(JSON.stringify(s))}});
  const key={workspace:recordSpace(c.id),kind:'productionCriteria',id:'current'},criteria=JSON.parse(JSON.stringify((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}})).payload));
  // One-day bottleneck is a test condition, not an official agronomic criterion.
  Object.assign(criteria.profiles[0].context.operations.rice.harvest,{from:day('10-01'),to:day('10-01'),staff:2,rainSensitive:false});
  if(process.env.KFARM_COMPARISON_E2E==='1'&&c.id==='demo'){
   // Deliberately overlapping test windows, NOT a rice agronomic recommendation.
   // Wind pushes the drone into the harvest day, which also loses a machine/worker.
   for(const code of ['fertilize','heading'])Object.assign(criteria.profiles[0].context.operations.rice[code],{from:day('09-30'),to:day('10-01')});
  }
  await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:criteria}});
 }
}
export function modelFreeRegistration(index:number){
 const input=fourCenterRegistration(index,randomUUID());
 // 1 ha at 0.16 ha/h plus setup leaves too little time to move the harvest
 // outside the absent worker's original shift without confirmed replacement.
 input.consultation.fields[0].area='10000';return input;
}
export function spareHarvester(owner:State,date:string){
 const machine=owner.machines.find(m=>m.id.includes('CB')&&!owner.missions.some(t=>t.resourceId===m.id&&t.scheduledDate===date));
 if(!machine)throw Error('No unused harvester in fixed acceptance inputs');
 return machine.id;
}
