import type {LaborOps} from './labor-operations';

export type ReserveLaborWindow={id:string;workerId:string;date:string;busy:{missionId?:string;startMinute:number;endMinute:number}[]};
export const reserveSupportId=(centerId:string,workerId:string,date:string)=>`reserve:${centerId}:${workerId}:${date}`;
export const isReserveSupport=(id:string)=>id.startsWith('reserve:');

/** Named, active employees with an explicitly registered standby duty. Do not
 * turn an aggregate staff count or an unconfirmed applicant into a reserve. */
export function reserveLaborWindows(ops:LaborOps,centerId:string,asOf:string,absences:{workerId:string;date:string;startMinute:number;endMinute:number}[]=[]):ReserveLaborWindow[]{
 return ops.people.filter(p=>p.active&&p.employment==='CENTER_RESERVE').flatMap(p=>[...new Set(p.standbyDates??[])].filter(date=>date>=asOf).map(date=>({
  id:reserveSupportId(centerId,p.id,date),workerId:p.id,date,
  busy:[...ops.jobs.filter(j=>j.status!=='STALE'&&j.date===date&&j.assigned.includes(p.id)).map(j=>({missionId:j.missionId,startMinute:j.startMinute,endMinute:j.startMinute+j.durationMinutes})),
   ...absences.filter(a=>a.workerId===p.id&&a.date===date).map(a=>({startMinute:a.startMinute,endMinute:a.endMinute}))],
 }))).sort((a,b)=>a.id.localeCompare(b.id));
}
