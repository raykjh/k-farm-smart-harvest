import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import * as svc from '@/lib/service';
import {retiredDemoWorkflow} from '@/lib/legacy-demo-boundary';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handleGET(){try{return NextResponse.json(await svc.read());}catch{return NextResponse.json({error:'데이터베이스가 준비되지 않았습니다. 실행 안내를 확인하세요.'},{status:503});}}
export const GET=withAuth('demo',handleGET);
export const POST=withAuth('demo',async()=>NextResponse.json(retiredDemoWorkflow,{status:410}));
