import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {asPrincipal} from '../lib/auth';
import {testPrincipal,testSession} from './auth-fixture';
import {GET,POST} from '../app/api/capacity-studies/route';
import {saveCapacityStudy,calculateSavedCapacityStudy,listCapacityStudies,listCapacityComparisons} from '../lib/capacity-study-store';
import {capacityStudySchema,contentHash,distributeScenarioCrops,referenceCropWeights} from '../lib/capacity-study-input';
import {cadastralStudy} from '../lib/four-center-cadastre';
import {syntheticCadastre} from './synthetic-cadastre';
import * as artifacts from '../lib/provider-artifacts';
const fixture=()=>capacityStudySchema.parse({title:'격리 API 테스트',population:{basis:'SYNTHETIC_OWNER_POPULATION',description:'Not actual cadastre or owners',seed:'test',participationRate:1,owners:[{id:'owner-test'}],parcels:[{pnu:'0000000000000000001',ownerId:'owner-test',centerId:'demo',areaM2:1000,applied:true,cropId:'rice',year:2026,geographicBasis:'SYNTHETIC_TEST_ONLY',geographicSource:'isolated test',suitability:'SUITABLE',cropLocked:false,existingBearingOrchard:false}]},includeConditionalReserve:true,overrides:[]});
const count=async()=>({centers:await db.center.findMany({orderBy:{id:'asc'}}),outbox:await db.outbox.count(),receipts:await db.receipt.count(),calls:await db.aiCall.count()});
it('isolates center scope, versions baselines, rejects stale calculation/save, preserves operational records',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated DB required');
 const id=randomUUID(),before=await count(),p={...testPrincipal,centerId:'demo'};
 try{await asPrincipal(p,async()=>{
  const input=fixture(),a=await saveCapacityStudy({id,expectedVersion:0,input});
  expect(a.version).toBe(1);expect(a.baseline.machines.length).toBeGreaterThan(0);
  await expect(saveCapacityStudy({id,expectedVersion:0,input})).rejects.toThrow('변경');
  await asPrincipal({...p,centerId:'janggye'},async()=>expect((await listCapacityStudies()).some(i=>i.id===id)).toBe(false));
  await expect(calculateSavedCapacityStudy({id,expectedVersion:1,baselineHash:'f'.repeat(64),scenario:'REFERENCE'})).rejects.toThrow('오래된');
  expect(contentHash(a.baseline)).not.toBe(a.baselineHash); // PostgreSQL JSONB key ordering.
  const result=await calculateSavedCapacityStudy({id,expectedVersion:1,baselineHash:a.baselineHash,scenario:'REFERENCE'},async(x,b)=>({inputHash:b.inputHash,baselineHash:contentHash(b),results:[],recommendation:{source:'DEVELOPMENT_RULES',inferenceCalled:false,alternativeId:null,approval:'NOT_AN_OPERATIONAL_APPROVAL'},explanation:'isolated fixture'}));
  expect(result.recommendation.inferenceCalled).toBe(false);expect(result.baselineHash).toBe(a.baselineHash);
  expect((await listCapacityComparisons()).some(r=>(r.data as any).baselineId===id)).toBe(true);
  const comparison=(await listCapacityComparisons()).find(r=>r.data.baselineId===id)!;
  expect(comparison.data.baselineHash).toBe(a.baselineHash);
  const legacy={...comparison.data,baselineHash:contentHash(a.baseline)};
  await db.workRecord.update({where:{workspace_kind_id:{workspace:'capacity-study:demo',kind:'comparison',id:comparison.id}},data:{payload:legacy}});
  expect((await listCapacityComparisons()).find(r=>r.id===comparison.id)!.data.baselineHash).toBe(a.baselineHash);
  // Read repair does not modify the stored comparison, nor bless unknown hashes.
  const stored=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'capacity-study:demo',kind:'comparison',id:comparison.id}}});expect(stored.payload).toEqual(legacy);
  await db.workRecord.update({where:{workspace_kind_id:{workspace:'capacity-study:demo',kind:'comparison',id:comparison.id}},data:{payload:{...legacy,baselineHash:'a'.repeat(64)}}});
  expect((await listCapacityComparisons()).find(r=>r.id===comparison.id)!.data.baselineHash).toBe('a'.repeat(64));
  await asPrincipal({...p,centerId:'janggye'},async()=>expect((await listCapacityComparisons()).some(r=>(r.data as any).baselineId===id)).toBe(false));
  const b=await saveCapacityStudy({id,expectedVersion:1,input});expect(b.version).toBe(2);
  expect(await db.workRecord.count({where:{workspace:'capacity-study:demo',kind:'baselineRevision',id:{startsWith:id+':'}}})).toBe(2);
  const obsolete={input:b.input,baseline:{...b.baseline,inputHash:'0'.repeat(64)},baselineHash:b.baselineHash};
  await db.workRecord.update({where:{workspace_kind_id:{workspace:'capacity-study:demo',kind:'baseline',id}},data:{payload:JSON.parse(JSON.stringify(obsolete))}});
  await expect(calculateSavedCapacityStudy({id,expectedVersion:2,baselineHash:b.baselineHash,scenario:'REFERENCE'})).rejects.toThrow('작업 생성 기준');
 });expect(await count()).toEqual(before);
 }finally{await db.workRecord.deleteMany({where:{workspace:'capacity-study:demo',OR:[{id},{id:{startsWith:id+':'}},{kind:'comparison',payload:{path:['baselineId'],equals:id}}]}})}
});
it('checks API auth/origin and staff cannot freeze baselines; input exports can be reimported',async()=>{
 const staff=await testSession('CENTER_STAFF'),admin=await testSession();let savedId='';
 // Replace only the optional local provider-file boundary, not business logic.
 const reader=vi.spyOn(artifacts,'requireProviderArtifact');
 const req=(headers:Record<string,string>,action:string,input:unknown)=>new NextRequest('http://127.0.0.1:3100/api/capacity-studies',{method:'POST',headers,body:JSON.stringify({action,input})});
 try{
  expect((await GET(new NextRequest('http://127.0.0.1:3100/api/capacity-studies'))).status).toBe(401);
  reader.mockImplementation(()=>{throw new artifacts.ProviderArtifactError('PROVIDER_DATA_REQUIRED')});
  const missing=await GET(new NextRequest('http://127.0.0.1:3100/api/capacity-studies?sample=four-centers-2026',{headers:staff.headers}));
  expect(missing.status).toBe(503);expect((await missing.json()).code).toBe('PROVIDER_DATA_REQUIRED');
  reader.mockReturnValue({input:distributeScenarioCrops(cadastralStudy(syntheticCadastre,2026),referenceCropWeights,'reference-weighted-v1')});
  const publicSample=await GET(new NextRequest('http://127.0.0.1:3100/api/capacity-studies?sample=four-centers-2026',{headers:staff.headers}));expect(publicSample.status).toBe(200);
  const sample=await POST(req(staff.headers,'analyze',await publicSample.json()));expect(sample.status,await sample.clone().text()).toBe(200);
  expect((await sample.json()).participation.selectedCount).toBe(33);
  expect((await POST(req(staff.headers,'saveBaseline',{id:randomUUID(),expectedVersion:0,input:fixture()}))).status).toBe(403);
  expect((await POST(req({...admin.headers,origin:'https://example.com'},'analyze',fixture()))).status).toBe(403);
  const analyzed=await POST(req(admin.headers,'analyze',fixture()));expect(analyzed.status).toBe(200);const d=await analyzed.json();
  expect(d.taskCount).toBe(9);expect(d.participation.selectedCount).toBe(1);
  expect((await POST(req(staff.headers,'distribute',fixture()))).status).toBe(200);
  const again=await POST(req(admin.headers,'analyze',{input:d.input,resources:d.baseline}));expect(again.status).toBe(200);expect((await again.json()).baseline).toEqual(d.baseline);
  savedId=randomUUID();expect((await POST(req(admin.headers,'saveBaseline',{id:savedId,expectedVersion:0,input:fixture()}))).status).toBe(200);
  expect((await POST(req(admin.headers,'saveBaseline',{id:savedId,expectedVersion:0,input:fixture()}))).status).toBe(409);
 }finally{reader.mockRestore();await staff.cleanup();await admin.cleanup();if(savedId)await db.workRecord.deleteMany({where:{workspace:'capacity-study:demo',OR:[{id:savedId},{id:{startsWith:savedId+':'}}]}})}
});
