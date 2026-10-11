import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal} from '@/lib/auth';
import {workloadCrops,workloadEquipment,workloadSources,WORKLOAD_CATALOG_VERSION} from '@/lib/crop-workload-catalog';
import {summarizeCapacity} from '@/lib/capacity-workload';
import {baselineResourcesSchema,distributeScenarioCrops,referenceCropWeights} from '@/lib/capacity-study-input';
import {listCapacityStudies,listCapacityComparisons,saveCapacityStudy,calculateSavedCapacityStudy,CapacityStudyConflict} from '@/lib/capacity-study-store';
import {requireProviderArtifact,ProviderArtifactError} from '@/lib/provider-artifacts';

export const GET=withAuth('capacity-studies',async req=>{
 if(req.nextUrl.searchParams.get('sample')==='four-centers-2026'){
  try{return NextResponse.json(requireProviderArtifact('capacityStudy'),{headers:{'Cache-Control':'no-store'}});}
  catch(error){if(error instanceof ProviderArtifactError)return NextResponse.json({error:error.message,code:error.code},{status:503});throw error;}
 }
 return NextResponse.json({items:await listCapacityStudies(),comparisons:await listCapacityComparisons(),crops:workloadCrops,equipment:workloadEquipment,sources:workloadSources,version:WORKLOAD_CATALOG_VERSION,canSave:currentPrincipal()?.role!=='CENTER_STAFF',inferenceCalled:false});
});
export const POST=withAuth('capacity-studies',async req=>{
 try{
  const b=z.object({action:z.enum(['analyze','distribute','saveBaseline','compare']),input:z.unknown()}).strict().parse(await req.json());
  if(b.action==='analyze'||b.action==='distribute'){
   const wrapper=b.input as {input?:unknown;resources?:unknown}|null;
   const source=wrapper?.input??b.input;
   const r=summarizeCapacity(b.action==='distribute'?distributeScenarioCrops(source,referenceCropWeights,'reference-weighted-v1'):source),{tasks,input,...summary}=r;
   if(wrapper?.resources){const resources=baselineResourcesSchema.parse(wrapper.resources);if(resources.inputHash!==r.inputHash)throw new CapacityStudyConflict('내보낸 입력·자원 기준이 일치하지 않습니다.');summary.baseline=resources;}
   return NextResponse.json({...summary,input,taskCount:tasks.length,cropCount:new Set(tasks.map(t=>t.cropId)).size,conditionalCount:tasks.filter(t=>t.conditional).length,
    cropDemand:workloadCrops.map(c=>({id:c.id,fields:r.participation.parcels.filter(p=>p.cropId===c.id).length,tasks:tasks.filter(t=>t.cropId===c.id).length}))});
  }
  if(b.action==='saveBaseline')return NextResponse.json({item:await saveCapacityStudy(b.input),operatingRecordsChanged:false});
  return NextResponse.json(await calculateSavedCapacityStudy(b.input));
 }catch(e){return NextResponse.json({error:e instanceof ZodError?e.issues.map(i=>i.message).join('\n'):e instanceof Error?e.message:'처리 실패'}, {status:e instanceof CapacityStudyConflict?409:e instanceof ZodError?400:422});}
});
