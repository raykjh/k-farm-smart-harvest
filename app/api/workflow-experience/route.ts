import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal} from '@/lib/auth';
import {db} from '@/lib/db';
// Historical experience records remain readable; never migrate or delete implicitly.
export const GET=withAuth('workflow-experience',async()=>{
 const row=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:'experience',kind:'workflow',id:currentPrincipal()!.id}}});
 return NextResponse.json({retired:true,registrationUrl:'/register',version:row?.version??0,state:row?.payload??null});
});
export const POST=withAuth('workflow-experience',async()=>NextResponse.json({error:'별도 체험 계산은 종료되었습니다. 농지 등록과 공통 계획·배차를 이용하세요.',code:'WORKFLOW_RETIRED',registrationUrl:'/register'},{status:410}));
