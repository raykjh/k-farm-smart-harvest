import {receiveWorkResult,correctWorkDuration} from '@/lib/work-result-receipt';
import {recordSpace,reportSpace} from '@/lib/workspace';
import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {saveExecution,saveReportSnapshot,RecordConflict} from '@/lib/execution-records';
export const dynamic='force-dynamic';
async function handleGET(){try{
 const [history,snapshots]=await Promise.all([db.workRecord.findMany({where:{workspace:recordSpace(),kind:'taskExecutionAssessment'},orderBy:{updatedAt:'desc'}}),db.workRecord.findMany({where:{workspace:reportSpace(),kind:'confirmedReport'},orderBy:{updatedAt:'desc'}})]);
 return NextResponse.json({history,snapshots},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'기록 조회 실패'},{status:503})}}
async function handlePOST(req:Request){
 try{const {kind,input}=await req.json();if(!['execution','snapshot','received','correction'].includes(kind))return NextResponse.json({error:'종류 확인 필요'},{status:400});return NextResponse.json({item:kind==='received'?await receiveWorkResult(input):kind==='correction'?await correctWorkDuration(input):kind==='execution'?await saveExecution(input):await saveReportSnapshot(input)});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'저장 실패'},{status:e instanceof RecordConflict?409:400})}
}

export const GET=withAuth('execution-records',handleGET);
export const POST=withAuth('execution-records',handlePOST);
