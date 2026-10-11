import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {cancelTasks} from '@/lib/task-cancellations';
export const POST=withAuth('task-cancellations',async req=>{
 try{return NextResponse.json(await cancelTasks(await req.json()))}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'작업 취소 실패'},{status:409})}
});
