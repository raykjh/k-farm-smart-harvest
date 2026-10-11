import {centerId as activeCenterId} from '@/lib/workspace';
import {lockCenterPool} from '@/lib/center-resources';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {actorLabel} from '@/lib/auth';
import {applyEquipmentEdit,equipmentInput} from '@/lib/equipment-register';
import {nextEquipmentCode} from '@/lib/equipment-code';
import type {State} from '@/lib/types';
import type {Prisma} from '@prisma/client';
const input=z.object({version:z.number().int(),existingId:z.string().optional(),autoCode:z.boolean().optional(),equipment:equipmentInput}).strict();
export const POST=withAuth('equipment',async(req:NextRequest)=>{
 try{const b=input.parse(await req.json());const id=await db.$transaction(async tx=>{
  await lockCenterPool(tx);
  const row=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}}),s=row.state as unknown as State;
  if(s.planVersion!==b.version)throw Error('자료가 변경되었습니다. 새로고침 후 다시 확인하세요.');
  const equipment=b.autoCode&&!b.existingId?{...b.equipment,id:nextEquipmentCode(s,b.equipment.kind,activeCenterId())}:b.equipment;
  const others=await tx.center.findMany({where:{id:{not:activeCenterId()}}});
  if(!b.existingId&&others.some(c=>(c.state as unknown as State).machines.some(m=>m.id===equipment.id)))throw Error('다른 센터에 등록된 장비코드입니다.');
  const old=s.machines.find(m=>m.id===b.existingId);
  if(old&&others.some(c=>(c.state as unknown as State).missions.some(m=>m.resourceId===old.id&&!['COMPLETED','CANCELLED'].includes(m.status)))&&(old.status!==equipment.status||old.capacityHaHour!==equipment.capacityHaHour))throw Error('다른 센터에 연결된 작업의 영향 검토가 필요합니다. 고장은 공유 장비 고장 기록을 이용하세요.');
  const next=applyEquipmentEdit(s,equipment,b.existingId,s.centerSharing?.centerId??activeCenterId());
  await tx.center.update({where:{id:activeCenterId()},data:{state:next as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  await tx.audit.create({data:{centerId:activeCenterId(),action:b.existingId?'equipment.edit':'equipment.create',detail:{actor:actorLabel(),id:equipment.id,planVersion:next.planVersion}}});
  return equipment.id;
 });return NextResponse.json({ok:true,id});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'저장 실패'},{status:409})}
});
