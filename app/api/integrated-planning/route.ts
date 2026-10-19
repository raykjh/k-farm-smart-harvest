import {NextResponse} from 'next/server';
import {z} from 'zod';
import {withAuth} from '@/lib/auth-route';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {centerId} from '@/lib/workspace';
import {db} from '@/lib/db';
import {createJointDraft,readJointDraftViews,stageJointDraft} from '@/lib/integrated-plan-service';
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('plan'),requestId:z.string().uuid(),mode:z.enum(['RULES','AI'])}).strict(),
 z.object({action:z.literal('stage'),requestId:z.string().uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),network:z.boolean().default(false)}).strict(),
]);
export const GET=withAuth('integrated-planning',async()=>{
 const principal=currentPrincipal()!,audience=principal.role==='SUPER_ADMIN'?'network':centerId();
 const items=await db.$transaction(tx=>readJointDraftViews(tx,audience),{timeout:60000,isolationLevel:'RepeatableRead'});
 return NextResponse.json({audience,canPlan:['CENTER_ADMIN','SUPER_ADMIN'].includes(principal.role),canStage:principal.role==='CENTER_ADMIN',items});
});
export const POST=withAuth('integrated-planning',async req=>{
 try{
  const b=command.parse(await req.json()),actor=actorLabel(),principal=currentPrincipal()!;
  if(b.action==='plan'){
   const audience=principal.role==='SUPER_ADMIN'?'network':centerId();
   await createJointDraft({requestId:b.requestId,mode:b.mode,audience},actor);
   const items=await db.$transaction(tx=>readJointDraftViews(tx,audience),{timeout:60000,isolationLevel:'RepeatableRead'});
   return NextResponse.json({item:items.find(i=>i.requestId===b.requestId)??null});
  }
  if(principal.role!=='CENTER_ADMIN')throw Error('센터 관리자만 계획 검토 목록에 반영할 수 있습니다.');
  return NextResponse.json(await db.$transaction(tx=>stageJointDraft(tx,{...b,audience:b.network?'network':centerId()},actor),{timeout:60000}));
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'통합계획 실패'},{status:409})}
});
