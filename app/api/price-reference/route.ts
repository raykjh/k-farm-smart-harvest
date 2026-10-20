import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {priceQuerySchema} from '@/lib/price-reference';
import {importPriceHistory,readPriceHistory} from '@/lib/price-reference-store';
export const GET=withAuth('price-reference',async req=>{
 const q=priceQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));if(!q.success)return NextResponse.json({error:'작물과 31일 이내의 조회 기간을 확인하세요.'},{status:400});
 return NextResponse.json({...await readPriceHistory(q.data),canImport:currentPrincipal()?.role==='SUPER_ADMIN',configured:!!process.env.AT_PRICE_SERVICE_KEY});
});
export const POST=withAuth('price-reference',async req=>{
 const q=priceQuerySchema.safeParse(await req.json());if(!q.success)return NextResponse.json({error:'작물과 31일 이내의 수집 기간을 확인하세요.'},{status:400});
 try{return NextResponse.json(await importPriceHistory(q.data,actorLabel()));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'가격 수집 실패'},{status:422});}
});
