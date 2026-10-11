import type {State} from './types';
// Scenario history, not verified agronomic dates or real work completion.
export function demoSeason2026(input:State):State{
 const s=structuredClone(input);
 for(const m of s.missions){
  if(m.status==='CANCELLED')continue;
  if(m.resourceId){m.month=9;delete m.scheduledDate;continue}
  const ordinal=Number(m.id.split('-').at(-1));
  const month=Number.isFinite(ordinal)?1+Math.floor((ordinal-1)*12/21):m.month;
  m.month=Math.max(1,Math.min(12,month));
  m.scheduledDate=`2026-${String(m.month).padStart(2,'0')}-${String(5+(Number.isFinite(ordinal)?ordinal%20:0)).padStart(2,'0')}`;
  m.status=m.scheduledDate<'2026-09-09'?'COMPLETED':'PLANNED';
 }
 // Production ledger is recalculated from the current scenario year on read.
 delete s.productionLedger;
 return s;
}
