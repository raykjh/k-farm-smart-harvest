import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {readOperatingLedger,saveOperatingEntry} from '@/lib/operating-ledger-store';
async function get(req:NextRequest){try{
 const year=z.coerce.number().int().min(2000).max(2200).parse(req.nextUrl.searchParams.get('year'));
 return NextResponse.json(await db.$transaction(tx=>readOperatingLedger(tx,year),{isolationLevel:'RepeatableRead'}),{headers:{'Cache-Control':'no-store'}});
}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'조회 실패'},{status:400})}}
async function post(req:NextRequest){try{
 return NextResponse.json({ok:true,entry:await saveOperatingEntry(await req.json())});
}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'저장 실패'},{status:409})}}
export const GET=withAuth('operating-ledger',get);
export const POST=withAuth('operating-ledger',post);
