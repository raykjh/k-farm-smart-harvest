import {NextResponse,type NextRequest} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal} from '@/lib/auth';
import {db} from '@/lib/db';
import {mutateReservation} from '@/lib/reservation-lifecycle';
import type {State} from '@/lib/types';
import {z} from 'zod';
import {migrateReservations,cancelLinkedReservation} from '@/lib/reservation-operations';
export const GET=withAuth('shared-reservations',async()=>{
 const actor=currentPrincipal()!;
 const center=actor.centerId?await db.center.findUnique({where:{id:actor.centerId}}):null;
 const owned=new Set(center?(center.state as unknown as State).machines.filter(m=>!m.ownerCenterId||m.ownerCenterId===center.id).map(m=>m.id):[]);
 const rows=await db.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
 const cancellations=await db.workRecord.findMany({where:{workspace:'shared',kind:'cancelledReservation'}});
 const centers=actor.role==='SUPER_ADMIN'?await db.center.findMany():center?[center]:[];
 const seen=new Set<string>();
 const cancelled=cancellations.sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime()).flatMap(x=>{const p=x.payload as any;if(!p.before||actor.role!=='SUPER_ADMIN'&&p.reservation.centerId!==actor.centerId)return [];const m=(centers.find(c=>c.id===p.reservation.centerId)?.state as unknown as State|undefined)?.missions.find(m=>m.id===p.reservation.taskId);const key=p.reservation.centerId+':'+p.reservation.taskId;if(!m||m.status!=='HELD'||m.scheduledDate||seen.has(key))return [];seen.add(key);return [{id:x.id,taskId:p.reservation.taskId,centerId:p.reservation.centerId,label:p.before.label,reason:p.reason}];});
 return NextResponse.json({cancelled,reservations:rows.filter(x=>{const r=x.payload as any;return actor.role==='SUPER_ADMIN'||r.centerId===actor.centerId||owned.has(r.resourceId)}).map(x=>({...(x.payload as object),version:x.version}))});
});
export const POST=withAuth('shared-reservations',async(req:NextRequest)=>{
 try{const body=await req.json();return NextResponse.json(await db.$transaction(async tx=>{
 const actor=currentPrincipal()!;
 if(body.action==='migrate'){const b=z.object({action:z.literal('migrate'),centerId:z.string().min(1),apply:z.boolean()}).strict().parse(body);return migrateReservations(tx,b.centerId,actor,b.apply);}
 if(body.action==='cancelLinked'){const b=z.object({action:z.literal('cancelLinked'),id:z.string().min(1),version:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict().parse(body);return cancelLinkedReservation(tx,b.id,b.version,b.reason,actor);}
 return mutateReservation(tx,body,actor);
 },{isolationLevel:'Serializable',timeout:15000}));}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'예약 처리 실패'},{status:409})}
});
