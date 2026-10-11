import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {createHash} from 'node:crypto';
export const dynamic='force-dynamic';
async function handleGET(){
 try{
 const rows=await db.$queryRaw<{id:string;payload:any;updatedAt:Date}[]>`SELECT id,payload,"updatedAt" FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='taskExecutionAssessment' ORDER BY "updatedAt" DESC,id`;
 const seen=new Set<string>();const items=rows.filter(r=>{if(seen.has(r.payload.missionId))return false;seen.add(r.payload.missionId);return true}).map(r=>r.payload);
 const changes=await db.$queryRaw<{payload:any}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='taskPlanChange' ORDER BY "updatedAt" DESC LIMIT 100`;
 const notices=await db.outbox.findMany({where:{centerId:activeCenterId()},orderBy:{createdAt:'desc'},take:100});
 const center=await db.center.findUnique({where:{id:activeCenterId()}});
 const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const stateHash=hash(center?.state),historyHash=hash(items),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const proposals=await db.workRecord.findMany({where:{workspace:recordSpace(),kind:'replanning'},orderBy:{updatedAt:'desc'}});
 const approvals=proposals.flatMap(r=>{const p=r.payload as any;return p.result?.diff?.length&&p.status==='REVIEW_REQUIRED'&&p.expires>Date.now()&&p.asOf===today&&p.hash===stateHash&&p.historyHash===historyHash?[{id:r.id,missionIds:p.result.diff.map((d:any)=>d.id),day:p.input.day,result:{...p.result,proposalId:r.id}}]:[]});
 return NextResponse.json({items,changes:changes.map(r=>r.payload),notices,approvals},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'History unavailable'},{status:503})}
}

export const GET=withAuth('work-history',handleGET);
