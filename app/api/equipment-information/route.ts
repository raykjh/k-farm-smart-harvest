import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal} from '@/lib/auth';
import {db} from '@/lib/db';
import type {State} from '@/lib/types';
import type {LedgerMachine} from '@/lib/equipment-register';
export const runtime='nodejs';
export const GET=withAuth('equipment-information',async()=>{
 const user=currentPrincipal()!;
 // Shared reference library is global. Unit inventory remains strictly center-scoped.
 if(user.role==='SUPER_ADMIN')return NextResponse.json({centerId:null,machines:[]});
 const row=await db.center.findUnique({where:{id:user.centerId!}});
 const machines=((row?.state as unknown as State|undefined)?.machines??[]) as LedgerMachine[];
 return NextResponse.json({centerId:user.centerId,machines:machines.filter(m=>!m.ownerCenterId||m.ownerCenterId===user.centerId)});
});
