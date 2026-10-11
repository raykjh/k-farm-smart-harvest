import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {centerId,recordSpace} from '@/lib/workspace';
import {currentPrincipal} from '@/lib/auth';
import {recoveryRows,type LaborRecovery} from '@/lib/labor-recovery-store';
import {emptyLaborOps,type LaborOps} from '@/lib/labor-operations';
import {sharedLaborRows,type LaborShare} from '@/lib/labor-sharing';
import {planningState,readExecutionHistory} from '@/lib/replan-history';
import {immovable} from '@/lib/replan-scope';
import type {State} from '@/lib/types';

export const GET=withAuth('labor-recovery',async()=>{
 const id=centerId(),center=await db.center.findUniqueOrThrow({where:{id}}),state=planningState(center.state as unknown as State,await readExecutionHistory());
 const roster=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(id),kind:'laborOperations',id:'current'}}}),ops=(roster?.payload??emptyLaborOps()) as unknown as LaborOps;
 const shares=(await sharedLaborRows(db)).map(r=>r.payload as unknown as LaborShare);
 const issues=(await recoveryRows(db,id)).map(r=>r.payload as unknown as LaborRecovery).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));
 return NextResponse.json({canManage:currentPrincipal()?.role==='CENTER_ADMIN',state,issues:issues.filter(r=>r.status==='OPEN').concat(issues.filter(r=>r.status==='RESOLVED').slice(0,20)).map(r=>({...r,tasks:r.tasks.map(t=>{
  const m=state.missions.find(m=>m.id===t.id),j=ops.jobs.find(j=>j.missionId===t.id&&j.status==='OPEN');
  return {id:t.id,label:m?.label??t.id,date:m?.scheduledDate,movable:!!m&&!immovable(m),shortage:j?Math.max(0,j.count-j.assigned.length-shares.filter(s=>s.borrowerCenterId===id&&s.jobId===j.id&&s.sourceHash===j.sourceHash&&s.status==='ASSIGNED').length):null};
 })}))},{headers:{'Cache-Control':'no-store'}});
});
