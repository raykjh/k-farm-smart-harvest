import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {actorLabel} from '@/lib/auth';
import {centerId,recordSpace} from '@/lib/workspace';
import {laborPolicyInput} from '@/lib/labor-policy';
import {readLaborPolicy} from '@/lib/labor-policy-store';
import {reportHash} from '@/lib/execution-records';
import type {LaborOps} from '@/lib/labor-operations';
const input=z.object({requestId:z.string().uuid(),version:z.number().int().min(0),policy:laborPolicyInput}).strict();
async function get(req:NextRequest){try{
 const year=z.coerce.number().int().min(2000).max(2200).parse(req.nextUrl.searchParams.get('year'));
 return NextResponse.json(await readLaborPolicy(db,centerId(),year),{headers:{'Cache-Control':'no-store'}});
}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'조회 실패'},{status:400})}}
async function post(req:NextRequest){try{
 const b=input.parse(await req.json()),hash=reportHash(b),result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${centerId()} FOR UPDATE`;
  const receipt={workspace:recordSpace(),kind:'laborPolicyHistory',id:b.requestId};
  const prior=await tx.workRecord.findUnique({where:{workspace_kind_id:receipt}});
  if(prior){if((prior.payload as any).hash!==hash)throw Error('중복 요청 내용 불일치');return {ok:true,alreadyApplied:true};}
  const key={workspace:recordSpace(),kind:'laborPolicy',id:String(b.policy.year)},current=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  if((current?.version??0)!==b.version)throw Error('공통 기준이 변경되었습니다. 다시 불러오세요.');
  const roster=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'laborOperations',id:'current'}}});
  const ops=roster?.payload as unknown as LaborOps|undefined;
  const named=ops?.people.filter(p=>p.active&&p.employment==='CENTER_RESERVE').length??0;
  if(b.policy.reserveCount<named)throw Error('등록된 직접고용 인원보다 적게 설정할 수 없습니다.');
  if(ops?.jobs.some(j=>j.status==='OPEN'&&j.date.startsWith(String(b.policy.year))&&(j.reserveSlots??[]).some(slot=>Number(slot)>b.policy.reserveCount-named)))throw Error('배정 중인 직접고용 인력이 있습니다. 배정을 먼저 조정하세요.');
  await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,version:1,payload:b.policy},update:{version:{increment:1},payload:b.policy}});
  await tx.workRecord.create({data:{...receipt,payload:{hash,before:current?.payload??null,after:b.policy,actor:actorLabel(),at:new Date().toISOString()}}});
  return {ok:true,version:b.version+1};
 });return NextResponse.json(result);
}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'저장 실패'},{status:409})}}
export const GET=withAuth('labor-policy',get);
export const POST=withAuth('labor-policy',post);
