import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal} from '@/lib/auth';
import {readRetirementSnapshot} from '@/lib/demo-retirement-store';
import {planPreparedBatch} from '@/lib/prepared-batch-retirement';
import {preparedPlanSummary,preparedRetirementCommand,retirePreparedBatch,restorePreparedBatch} from '@/lib/prepared-batch-store';
export const GET=withAuth('prepared-inputs',async req=>{
 try{
  const batchId=req.nextUrl.searchParams.get('batchId'),centerId=req.nextUrl.searchParams.get('centerId');
  if(batchId&&centerId){z.string().uuid().parse(batchId);const result=await db.$transaction(async tx=>preparedPlanSummary(planPreparedBatch(await readRetirementSnapshot(tx),centerId,batchId)),{isolationLevel:'RepeatableRead',timeout:30000});return NextResponse.json(result);}
  const [batches,archives]=await Promise.all([db.workRecord.findMany({where:{kind:'demoInputBatch'},orderBy:{updatedAt:'desc'}}),db.workRecord.findMany({where:{workspace:'archive',kind:'preparedBatch'},orderBy:{updatedAt:'desc'}})]);
  return NextResponse.json({batches:batches.map(r=>{const p=r.payload as any;return {batchId:r.id,centerId:p.centerId,status:p.status,registrations:p.registrations?.length??0,updatedAt:r.updatedAt};}),archives:archives.map(r=>{const p=r.payload as any;return {id:r.id,batchId:p.batchId,centerId:p.centerId,status:p.status,counts:p.counts,updatedAt:r.updatedAt};})});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'입력 묶음 조회 실패'},{status:409});}
});
export const POST=withAuth('prepared-inputs',async req=>{
 try{const {action,...input}=await req.json(),actor=currentPrincipal()!.id;
  if(action==='retire')return NextResponse.json(await retirePreparedBatch(db,preparedRetirementCommand.parse(input),actor));
  if(action==='restore'){const {id}=z.object({id:z.string().uuid()}).strict().parse(input);return NextResponse.json(await restorePreparedBatch(db,id,actor));}
  return NextResponse.json({error:'작업을 확인하세요.'},{status:400});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'정리 실패. 기존 기록을 유지했습니다.'},{status:409});}
});
