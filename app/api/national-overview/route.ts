import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {cropCodeSchema} from '@/lib/crop-registry';
import {readNationalOverview} from '@/lib/national-overview-store';
const filterSchema=z.object({year:z.coerce.number().int().min(2000).max(2200),quarter:z.coerce.number().int().min(1).max(4).optional(),crop:cropCodeSchema.optional(),region:z.string().regex(/^\d{2}(\d{3})?$/).optional(),center:z.string().max(80).optional(),origin:z.enum(['DEMO','REGISTERED']).optional()}).strict();
export const GET=withAuth('national-overview',async req=>{
 const filter=filterSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));if(!filter.success)return NextResponse.json({error:'조회 조건을 확인하세요.'},{status:400});
 const result=await db.$transaction(async tx=>{
  return readNationalOverview(tx,filter.data,new Date(Date.now()+9*3600000).toISOString().slice(0,10));
 },{isolationLevel:'RepeatableRead',timeout:30000});
 return NextResponse.json(result);
});
