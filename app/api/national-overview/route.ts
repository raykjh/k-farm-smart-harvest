import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {cropCodeSchema} from '@/lib/crop-registry';
import {buildNationalOverview} from '@/lib/national-overview';
import {recordSpace} from '@/lib/workspace';
import type {State} from '@/lib/types';
const filterSchema=z.object({year:z.coerce.number().int().min(2000).max(2200),quarter:z.coerce.number().int().min(1).max(4).optional(),crop:cropCodeSchema.optional(),region:z.string().regex(/^\d{2}(\d{3})?$/).optional(),center:z.string().max(80).optional(),origin:z.enum(['DEMO','REGISTERED']).optional()}).strict();
export const GET=withAuth('national-overview',async req=>{
 const filter=filterSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));if(!filter.success)return NextResponse.json({error:'조회 조건을 확인하세요.'},{status:400});
 const result=await db.$transaction(async tx=>{
  const centers=await tx.center.findMany({orderBy:{id:'asc'}});
  const records=await tx.workRecord.findMany({where:{workspace:{in:centers.map(c=>recordSpace(c.id))},kind:{in:['cultivation','cultivationPlan','continuousProduction','centerSettings','operatingLedger','taskExecutionAssessment','registrationOrigin']}},orderBy:[{workspace:'asc'},{updatedAt:'desc'},{id:'asc'}]});
  return buildNationalOverview(centers.map(c=>({...c,state:c.state as unknown as State})),records,filter.data,new Date(Date.now()+9*3600000).toISOString().slice(0,10));
 },{isolationLevel:'RepeatableRead',timeout:30000});
 return NextResponse.json(result);
});
