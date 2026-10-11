import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {readReport,reportHash} from '@/lib/execution-records';
export const dynamic='force-dynamic';
async function handleGET(){try{const report=await db.$transaction(readReport,{isolationLevel:'RepeatableRead'});return NextResponse.json({...report,hash:reportHash(report)},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'실적 조회 실패'},{status:503})}}

export const GET=withAuth('work-reports',handleGET);
