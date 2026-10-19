import type {Prisma} from '@prisma/client';
import type {Principal} from './auth';
import type {ReplanInput} from './annual-replanning';
import type {RepairLoanRequest,ResolutionNeed} from './automatic-replanning';
import type {EquipmentLoan} from './center-sharing';
import type {State} from './types';
import {lockCenterPool,saveLoan} from './center-resources';
import {geographicNeighbors} from './center-adjacency';
import {centerDefinition} from './center-registry';
import {sameEquipmentKind} from './equipment-code';
import {equipmentDownOn} from './equipment-downtime';
import {resourceDuration} from './replan-resource-options';
import {cropCodes,cropNames} from './crop-registry';
import {immovable} from './replan-scope';

/** Request, never book, a compatible neighbor's free equipment day. The owner
 * still confirms transport/operator and approval rechecks the live ledger. */
export async function requestRepairLoans(tx:Prisma.TransactionClient,state:State,input:ReplanInput,needs:ResolutionNeed[],actor:Principal,asOf:string):Promise<RepairLoanRequest[]>{
 if(!input.outage||!actor.centerId||!['CENTER_ADMIN','CENTER_STAFF'].includes(actor.role))return [];
 await lockCenterPool(tx);
 const neighbors=await geographicNeighbors(tx,actor.centerId),centers=await tx.center.findMany({orderBy:{id:'asc'}});
 const loans=(await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentLoan'}})).map(r=>r.payload as unknown as EquipmentLoan);
 const reservations=(await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}})).map(r=>r.payload as any);
 const results:RepairLoanRequest[]=[],used=new Map<string,number>();
 for(const need of needs){
  const task=state.missions.find(m=>m.id===need.missionId),original=state.machines.find(m=>m.id===task?.resourceId);
  if(!task||!input.ids.includes(task.id)||immovable(task)||String(task.status)==='WORKING'||!original||original.id!==input.outage.machineId||need.steps.some(s=>['DATA','WINDOW','PREREQUISITE'].includes(s)))continue;
  const window=task.planningWindow,crop=task.compatibilityCrop??cropCodes.find(c=>cropNames[c]===task.crop);
  if(!window||!crop||window.to<asOf)continue;
  const from=[need.from,asOf].sort().at(-1)!,target=input.preferred??task.scheduledDate??from,dates:string[]=[];
  for(let at=Date.parse(from),last=Math.min(Date.parse(need.to),Date.parse(from)+365*86400000);at<=last;at+=86400000){
   const date=new Date(at).toISOString().slice(0,10);
   if(date<window.from||date>window.to||window.allowedWindows&&!window.allowedWindows.some(w=>w.from<=date&&date<=w.to))continue;
   dates.push(date);
  }
  dates.sort((a,b)=>Math.abs(Date.parse(a)-Date.parse(target))-Math.abs(Date.parse(b)-Date.parse(target))||a.localeCompare(b));
  let selected=false;
  for(const date of dates){
   for(const owner of centers.filter(c=>neighbors.includes(c.id))){
    const ownerState=owner.state as unknown as State;
    for(const machine of [...ownerState.machines].sort((a,b)=>a.id.localeCompare(b.id))){
     if(machine.ownerCenterId&&machine.ownerCenterId!==owner.id||machine.status!=='AVAILABLE'||machine.safetyLock||!sameEquipmentKind(original,machine)||!machine.compatibleCrops?.includes(crop)||!(machine.capacityHaHour>0)||equipmentDownOn(machine,date)||machine.availableFrom&&date<machine.availableFrom||machine.availableUntil&&date>machine.availableUntil)continue;
     // Codes must uniquely identify the lender's resource; no inferred owner.
     if(centers.filter(c=>(c.state as unknown as State).machines.some(m=>m.id===machine.id&&(!m.ownerCenterId||m.ownerCenterId===c.id))).length!==1)continue;
     if(centers.some(c=>(c.state as unknown as State).missions.some(m=>m.resourceId===machine.id&&m.scheduledDate===date&&m.status!=='CANCELLED')))continue;
     const begin=Date.parse(date+'T00:00:00+09:00'),end=begin+86400000;
     if(reservations.some(r=>r.resourceId===machine.id&&Date.parse(r.from)<end&&begin<Date.parse(r.to)))continue;
     if(loans.some(l=>l.machineId===machine.id&&l.usableFrom<=date&&date<=l.usableUntil&&(l.status==='CONFIRMED'||l.status==='REQUESTED'&&l.borrowerCenterId!==actor.centerId)))continue;
     let duration:number;try{duration=resourceDuration(state,task,{machine,borrowed:true})}catch{continue}
     const loadKey=machine.id+':'+date;
     if(duration+(used.get(loadKey)??0)>32)continue;
     let loan=loans.find(l=>l.machineId===machine.id&&l.ownerCenterId===owner.id&&l.borrowerCenterId===actor.centerId&&l.status==='REQUESTED'&&l.usableFrom===date&&l.usableUntil===date);
     if(!loan){
      const saved=await saveLoan(tx,{id:crypto.randomUUID(),version:0,machineId:machine.id,ownerCenterId:owner.id,borrowerCenterId:actor.centerId,usableFrom:date,usableUntil:date,status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false},actor,`장비 수리 대체 요청: ${input.outage.machineId} (${input.outage.from} ~ ${input.outage.returnOn})`);
      loan=saved.loan;loans.push(loan);
     }
     used.set(loadKey,(used.get(loadKey)??0)+duration);
     const existing=results.find(r=>r.id===loan.id);
     if(existing)existing.missionIds.push(task.id);
     else results.push({id:loan.id,machineId:machine.id,ownerCenterId:owner.id,ownerName:centerDefinition(owner.id).name,from:date,to:date,missionIds:[task.id]});
     selected=true;break;
    }
    if(selected)break;
   }
   if(selected)break;
  }
 }
 return results;
}
