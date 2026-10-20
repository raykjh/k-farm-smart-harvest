import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {handleReplanning} from '@/lib/replanning-service';
import {db} from '@/lib/db';
import {recordSpace} from '@/lib/workspace';
export const runtime='nodejs';
export const POST=withAuth('replanning',req=>handleReplanning(req));
export const GET=withAuth('replanning',async()=>{
 const rows=await db.workRecord.findMany({where:{workspace:recordSpace(),kind:'automaticReplan'},orderBy:{updatedAt:'desc'},take:30});
 return NextResponse.json({requests:rows.map(r=>{const p=r.payload as any;return {id:r.id,at:r.updatedAt,policy:p.policy??null,status:p.status,input:p.input,result:p.result??null,error:p.error??null}})},{headers:{'Cache-Control':'no-store'}});
});
