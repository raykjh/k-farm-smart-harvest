import {recordSpace} from '@/lib/workspace';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {inWorkspace,parseWorkspace,centerId} from '@/lib/workspace';
import {retiredDemoWorkflow} from '@/lib/legacy-demo-boundary';
import {emptyCenter} from '@/lib/center-registry';
import {resourceView} from '@/lib/center-resources';
import * as service from '@/lib/service';
import {withRegisteredInventory} from '@/lib/inventory-view';
import type {FieldEntry} from '@/lib/field-record';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const empty=()=>emptyCenter(centerId());
async function handleGET(req:NextRequest){
 try{return await inWorkspace(parseWorkspace(req.nextUrl.searchParams.get('workspace')),async()=>{
  const row=await db.center.findUnique({where:{id:centerId()}});
  if(!row)return NextResponse.json({state:empty(),notices:[],aiMode:'DEMO_RULES',initialized:false},{headers:{'Cache-Control':'no-store'}});
  const data=await service.read();data.state=await resourceView(db,data.state,centerId());
  const inventory=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'fields',id:'current'}}});
  const contacts=await db.workRecord.findMany({where:{workspace:recordSpace(),kind:'consultation'}});
  const names=Object.fromEntries(contacts.map(c=>[c.id,(c.payload as {farmer?:{name?:string}}).farmer?.name??'']));
  return NextResponse.json({...data,state:withRegisteredInventory(data.state,(inventory?.payload??[]) as FieldEntry[],names),initialized:true},{headers:{'Cache-Control':'no-store'}});
 })}catch{return NextResponse.json({error:'작업 공간 또는 데이터베이스를 확인하세요.'},{status:503})}
}
async function handlePOST(req:NextRequest){
 try{const body=await req.json();
  if(body.action==='injectDemo')return NextResponse.json(retiredDemoWorkflow,{status:410});
  if(body.action!=='initialize')throw Error('지원하지 않는 작업');
  const selected=parseWorkspace(body.workspace??null);
  return await inWorkspace(selected,async()=>{const state=empty();
   // Create-only: never overwrite a populated or initialized space.
   await db.center.create({data:{id:centerId(),state:state as unknown as Prisma.InputJsonValue}});
   return NextResponse.json({ok:true});
  });
 }catch{return NextResponse.json({error:'입력 거부 또는 이미 존재하는 공간입니다. 기존 데이터는 덮어쓰지 않았습니다.'},{status:409})}
}

export const GET=withAuth('workspace',handleGET);
export const POST=withAuth('workspace',handlePOST);
