import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {actorLabel} from '@/lib/auth';
import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {loadEnvironmentBundle} from '@/lib/environment-planning-store';
import {environmentPlanningSchema,planningRegion} from '@/lib/environment-planning';
import {buildAnnualPlan,type AnnualPlan} from '@/lib/annual-plan';
import {previewAnnualDispatch} from '@/lib/annual-dispatch';
import type {FieldEntry} from '@/lib/field-record';
import type {State} from '@/lib/types';
import {resourceView} from '@/lib/center-resources';
import type {Cultivation} from '@/lib/cultivation';
import {growthReviewSchema} from '@/lib/environment-execution-check';
import {readShortForecast} from '@/lib/kma-forecast';
import {readCenterWeatherConfig} from '@/lib/center-settings-store';
import {weatherHash} from '@/lib/annual-replanning';
async function handleGET(){try{
 const r=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'fields',id:'current'}}});
 return NextResponse.json({fields:((r?.payload??[]) as unknown as FieldEntry[]).map(f=>({pnu:f.pnu,address:f.address,crop:f.crop,region:planningRegion(f)}))},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'농지 조회 실패'},{status:503});}}
async function handlePOST(req:Request){
 try{
 const b=z.object({pnu:z.string().min(1),selection:environmentPlanningSchema,save:z.boolean().optional(),cultivationId:z.string().uuid().optional(),expectedVersion:z.number().int().nonnegative().optional(),growthReview:growthReviewSchema.optional(),forecastRegionConfirmed:z.boolean().optional()}).strict().parse(await req.json());
 if(b.growthReview)b.growthReview.reviewer=actorLabel();
 if(b.save&&(!b.cultivationId||b.expectedVersion===undefined||!b.growthReview||!b.forecastRegionConfirmed))throw Error('재배 건·계획 버전·생육 확인·예보 지역 확인이 필요합니다.');
 const weather=b.save?await readShortForecast(await readCenterWeatherConfig()):null;
 const result=await db.$transaction(async tx=>{
  const row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace(),kind:'fields',id:'current'}}});
  const field=(row.payload as unknown as FieldEntry[]).find(f=>f.pnu===b.pnu);if(!field)throw Error('등록 농지를 선택하세요.');
  const year=Number(b.selection.from.slice(0,4));if(!b.selection.to.startsWith(year+'-'))throw Error('연간 미리보기는 같은 연도 내에서 선택하세요.');
  const old=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'annualPlan',id:String(year)}}});
  const context=(old?.payload as unknown as AnnualPlan|null)?.context??{};
  let cultivation:Cultivation|undefined;let version=0;
  if(b.cultivationId){
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cultivation-plan:${b.cultivationId}`}))`;
   const cycle=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace(),kind:'cultivation',id:b.cultivationId}}});cultivation=cycle.payload as unknown as Cultivation;
   if(cultivation.pnu!==b.pnu||cultivation.crop!==field.crop||b.selection.from<cultivation.start||b.selection.to>cultivation.end)throw Error('농지·작물·기간이 재배 건과 일치하지 않습니다.');
   const current=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'cultivationPlan',id:b.cultivationId}}});version=current?.version??0;
   if(current)Object.assign(context,(current.payload as unknown as AnnualPlan).context);
   if(b.save&&version!==b.expectedVersion)throw Error('재배계획이 변경되었습니다. 다시 불러오세요.');
  }
  const center=await tx.center.findUnique({where:{id:activeCenterId()}}),resources=center?await resourceView(tx,center.state as unknown as State,activeCenterId()):undefined;
  const plan=buildAnnualPlan([field],year,row.version,context,cultivation,await loadEnvironmentBundle(tx,b.selection),resources);
  if(b.save){
   const review=b.growthReview!;if(review.checkedOn>new Date(Date.now()+9*3600000).toISOString().slice(0,10))throw Error('미래 생육 확인일은 입력할 수 없습니다.');
   plan.environmentReview=review;plan.environmentForecastHash=weatherHash(weather!);
   const key={workspace:recordSpace(),kind:'cultivationPlan',id:b.cultivationId!},payload=JSON.parse(JSON.stringify(plan));
   await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload,version:version+1},update:{payload,version:version+1,updatedAt:new Date()}});
   await tx.workRecord.create({data:{workspace:recordSpace(),kind:'environmentPlanRevision',id:crypto.randomUUID(),payload:{cultivationId:b.cultivationId,version:version+1,plan:payload}}});
  }
  return {plan,dispatch:resources?(await previewAnnualDispatch(plan,resources)):null,status:b.save?'DRAFT_SAVED':'PREVIEW_ONLY',saved:!!b.save,version:b.save?version+1:version};
 },{isolationLevel:'RepeatableRead'});
 return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'계획 계산 실패'},{status:400});}
}

export const GET=withAuth('environment-plan',handleGET);
export const POST=withAuth('environment-plan',handlePOST);
