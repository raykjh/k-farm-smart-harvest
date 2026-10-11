import {recordSpace,centerId} from '@/lib/workspace';
import {resourceView} from '@/lib/center-resources';
import type {State} from '@/lib/types';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {cultivationSchema,checkCultivation,previousCultivationTerminals,type Cultivation} from '@/lib/cultivation';
import {planningContext} from '@/lib/planning-context';
import {buildAnnualPlan,type AnnualPlan} from '@/lib/annual-plan';
import type {FieldEntry} from '@/lib/field-record';
import {z} from 'zod';
const local=(r:NextRequest)=>['localhost:3100','127.0.0.1:3100'].includes(r.headers.get('host')??'')&&(!r.headers.get('origin')||['http://localhost:3100','http://127.0.0.1:3100'].includes(r.headers.get('origin')!));
async function handleGET(req:NextRequest){if(!local(req))return NextResponse.json({error:'출처 거부'},{status:403});const rows=await db.$queryRaw<{id:string;payload:Cultivation}[]>`SELECT id,payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='cultivation' ORDER BY id`;return NextResponse.json({items:rows},{headers:{'Cache-Control':'no-store'}});}
async function handlePOST(req:NextRequest){
 if(!local(req))return NextResponse.json({error:'출처 거부'},{status:403});
 try{const raw=await req.text();if(raw.length>100000)throw Error('입력 크기 초과');const b=z.object({cultivation:cultivationSchema,context:planningContext}).strict().parse(JSON.parse(raw));
 if(b.cultivation.source!=='REGISTERED')throw Error('이관 전용 출처');
 const result=await db.$transaction(async tx=>{
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fields:${recordSpace()}`}))`;
 const rows=await tx.$queryRaw<{payload:Cultivation}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='cultivation'`;
 const existing=rows.map(r=>r.payload),same=existing.find(c=>c.id===b.cultivation.id);
 if(same){if(JSON.stringify(same)!==JSON.stringify(b.cultivation))throw Error('기존 재배 건 ID입니다.');throw Error('이미 등록된 재배 건입니다.');}
 checkCultivation(b.cultivation,existing);
 const records=await tx.$queryRaw<{version:number;payload:FieldEntry[]}[]>`SELECT version,payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='fields' AND id='current' FOR UPDATE`;
 const field=records[0]?.payload.find(f=>f.pnu===b.cultivation.pnu);if(!field?.area)throw Error('면적이 있는 등록 농지가 필요합니다.');
 const center=await tx.center.findUniqueOrThrow({where:{id:centerId()}}),resources=await resourceView(tx,center.state as unknown as State,centerId());
 const plan=buildAnnualPlan([{...field,crop:b.cultivation.crop}],Number(b.cultivation.start.slice(0,4)),records[0].version,b.context,b.cultivation,undefined,resources);
 if(b.cultivation.previousId){const previous=existing.find(c=>c.id===b.cultivation.previousId)!,stored=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'cultivationPlan',id:previous.id}}});const previousPlan=stored?.payload as AnnualPlan|undefined;const terminals=previousCultivationTerminals(previous,previousPlan?.plots.flatMap(p=>p.tasks)??[]);for(const task of plan.plots[0].tasks)if(!task.predecessorKeys.length)task.predecessorKeys.push(...terminals);}
 for(const [kind,payload] of [['cultivation',b.cultivation],['cultivationPlan',plan]] as const)await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES (${recordSpace()},${kind},${b.cultivation.id},1,${JSON.stringify(payload)}::jsonb)`;
 return {id:b.cultivation.id,plan};
 },{timeout:20000});return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'등록 실패'},{status:409})}
}

export const GET=withAuth('cultivations',handleGET);
export const POST=withAuth('cultivations',handlePOST);
