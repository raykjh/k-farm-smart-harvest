import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {withAuth} from '@/lib/auth-route';
import {centerId} from '@/lib/workspace';
import {readSms,refreshSms,simulateSms} from '@/lib/sms-store';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare')}).strict(),
 z.object({action:z.literal('simulate'),id:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().uuid(),fail:z.boolean().default(false)}).strict()
]);
export const GET=withAuth('messages',async()=>NextResponse.json({provider:'NOT_CONNECTED',realSendingEnabled:false,items:await readSms(centerId())}));
export const POST=withAuth('messages',async(req:NextRequest)=>{
 try{const b=input.parse(await req.json());return NextResponse.json(b.action==='prepare'?await refreshSms(centerId()):await simulateSms(centerId(),b));}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'문자 처리 실패'},{status:409});}
});
