import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {listRegionalStandards,saveRegionalStandard,StandardConflict} from '@/lib/regional-crop-standard-store';
async function handleGET(){try{return NextResponse.json({items:await listRegionalStandards()},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'기준 자료를 불러오지 못했습니다. / Could not load standards.'},{status:503});}}
async function handlePOST(req:Request){
 const allowed=['http://127.0.0.1:3100','http://localhost:3100'];
 if(!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??'')||!allowed.includes(req.headers.get('origin')??''))return NextResponse.json({error:'출처 거부 / Origin rejected'},{status:403});
 try{return NextResponse.json({item:await saveRegionalStandard(await req.json()),automaticScheduling:false});}
 catch(e){if(e instanceof StandardConflict)return NextResponse.json({error:'다른 수정본이 저장되었습니다. 목록을 새로고침하고 다시 열어주세요. / Reload the newer revision.'},{status:409});
 if(e instanceof ZodError)return NextResponse.json({error:e.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('\n')},{status:400});
 if(e instanceof SyntaxError)return NextResponse.json({error:'잘못된 요청 / Invalid JSON'},{status:400});
 return NextResponse.json({error:'저장 실패. 입력은 유지됩니다. / Save failed; edits retained.'},{status:503});}
}

export const GET=withAuth('regional-crop-standards',handleGET);
export const POST=withAuth('regional-crop-standards',handlePOST);
