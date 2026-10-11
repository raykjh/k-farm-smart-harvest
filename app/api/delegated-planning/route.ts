import {resourceView} from '@/lib/center-resources';
import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {actorLabel} from '@/lib/auth';
import {commitDelegatedPlans} from '@/lib/delegated-commit';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {randomUUID,createHash} from 'node:crypto';
import {db} from '@/lib/db';
import {delegatedProposal,validateSettings} from '@/lib/delegated-planning';
import type {FieldEntry} from '@/lib/field-record';
import type {Cultivation} from '@/lib/cultivation';
import type {State} from '@/lib/types';
import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {SCHEDULING_ENGINE_VERSION} from '@/lib/scheduling-engine';
import {dispatchPlacementKey} from '@/lib/annual-dispatch';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify({engine:SCHEDULING_ENGINE_VERSION,value:v})).digest('hex');
const local=(r:NextRequest)=>['localhost:3100','127.0.0.1:3100'].includes(r.headers.get('host')??'')&&(!r.headers.get('origin')||['http://localhost:3100','http://127.0.0.1:3100'].includes(r.headers.get('origin')!));
const key=(kind:string,id='current')=>({where:{workspace_kind_id:{workspace:recordSpace(),kind,id}}});
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
async function snapshot(tx:Prisma.TransactionClient){
 const center=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}});
 const fields=await tx.workRecord.findUnique(key('fields'));
 const cycles=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'cultivation'},orderBy:{id:'asc'}});
 const contacts=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'consultation'},orderBy:{id:'asc'}});
 const settings=await tx.workRecord.findUnique(key('delegatedSettings'));
 return {state:await resourceView(tx,center.state as unknown as State,activeCenterId()),fields:(fields?.payload??[]) as FieldEntry[],version:fields?.version??0,cycles:cycles.map(c=>c.payload as unknown as Cultivation),contacts:contacts.map(c=>({id:c.id,payload:c.payload})),settings:settings?.payload,today:today()};
}
async function calculate(s:Awaited<ReturnType<typeof snapshot>>,idFor:(pnu:string)=>string){
 const names=Object.fromEntries(s.contacts.map(c=>[c.id,(c.payload as any).farmer?.name??'']));
 const missing=s.fields.filter(f=>f.mode==='full'&&!s.contacts.some(c=>{const p=c.payload as any;return c.id===f.consultationId&&p.consent===true&&p.fields?.some((v:any)=>v.pnu===f.pnu&&v.mode==='delegated')}));
 const p=(await delegatedProposal(s.fields.filter(f=>!missing.includes(f)),s.version,s.state,s.cycles,validateSettings(s.settings),idFor,s.today,names));
 p.pending.push(...missing.map(f=>({pnu:f.pnu,address:f.address,reason:'상담의 위임·정보 이용 설명 기록 확인 필요'})));return p;
}
async function handleGET(req:NextRequest){if(!local(req))return NextResponse.json({error:'출처 거부'},{status:403});try{const row=await db.workRecord.findUnique(key('delegatedSettings'));return NextResponse.json({settings:row?.payload??null},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'공통 기준 조회 실패'},{status:503})}}
async function handlePOST(req:NextRequest){
 if(!local(req))return NextResponse.json({error:'출처 거부'},{status:403});
 try{
 const raw=await req.text();if(raw.length>150000)throw Error('입력 크기 초과');const b=JSON.parse(raw);
 if(b.action==='settings'){
  const settings=validateSettings(b.settings);
  await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
   await tx.workRecord.upsert({...key('delegatedSettings'),create:{workspace:recordSpace(),kind:'delegatedSettings',id:'current',payload:json(settings)},update:{payload:json(settings),version:{increment:1}}});
  });
  return NextResponse.json({ok:true});
 }
 if(!['preview','approve'].includes(b.action))throw Error('알 수 없는 요청');
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fields:${recordSpace()}`}))`;
  await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='fields' AND id='current' FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='consultation' FOR SHARE`;
  const s=await snapshot(tx);
  if(b.action==='preview'){
   const ids:Record<string,string>={};
   const p=(await calculate(s,pnu=>ids[pnu]??(ids[pnu]=randomUUID())));
   const {state:_,...view}=p,proposalId=randomUUID(),expiresAt=Date.now()+10*60000;
   await tx.workRecord.create({data:{workspace:recordSpace(),kind:'delegatedProposal',id:proposalId,payload:json({hash:hash(s),ids,view,expiresAt,status:'REVIEW'})}});
   return {...view,proposalId,expiresAt};
  }
  z.string().uuid().parse(b.proposalId);if(b.provisionalAcknowledged!==true)throw Error('미확정 작업·권한·기상 확인 대기 및 모의 배차임을 확인하세요.');
  const record=await tx.workRecord.findUniqueOrThrow(key('delegatedProposal',b.proposalId)),saved=record.payload as any;
  if(saved.status==='APPLIED')return {...saved.result,alreadyApplied:true};
  if(saved.expiresAt<Date.now()||saved.hash!==hash(s))throw Error('농지·계획·자원·기준이 변경되었거나 만료되었습니다. 다시 계산하세요.');
  const p=(await calculate(s,pnu=>saved.ids[pnu]));
  if(p.plans.length!==saved.view.plans.length||p.plans.some(plan=>{
   const old=saved.view.plans.find((item:any)=>item.cultivation.id===plan.cultivation.id);
   return !old||old.cultivation.crop!==plan.cultivation.crop||dispatchPlacementKey(old.dispatch.assignments)!==dispatchPlacementKey(plan.dispatch.assignments);
  }))throw Error('계산된 배치가 검토한 내용과 다릅니다. 새 계획을 확인하세요.');
  if(p.approvalBlocked)throw Error('파종·수확 등 필수 작업의 자원 확보가 부족합니다. 부분 초안은 검토할 수 있지만 재배·배차 일괄 확정은 할 수 없습니다.');
  if(!p.assigned)throw Error('확정 가능한 작업이 없습니다.');
  const names=Object.fromEntries(s.contacts.map(c=>[c.id,(c.payload as any).farmer?.name??'']));
  const result=await commitDelegatedPlans(tx,{...s,plans:p.plans,names,proposalId:b.proposalId,actor:actorLabel()});
  await tx.workRecord.update({...key('delegatedProposal',b.proposalId),data:{payload:json({...saved,status:'APPLIED',result})}});
  await tx.audit.create({data:{centerId:activeCenterId(),action:'delegated.approve',detail:json({proposalId:b.proposalId,...result})}});
  return result;
 },{timeout:20000});
 return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'처리 실패'},{status:409})}
}

export const GET=withAuth('delegated-planning',handleGET);
export const POST=withAuth('delegated-planning',handlePOST);
