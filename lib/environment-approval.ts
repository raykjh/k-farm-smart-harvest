import {isClosedTask} from './task-lifecycle';
import type {Prisma} from '@prisma/client';
import type {AnnualPlan} from './annual-plan';
/** Lock referenced rows until approval commits; revision drift invalidates the saved draft. */
export async function assertEnvironmentReferences(tx:Prisma.TransactionClient,plan:AnnualPlan){
 for(const plot of plan.plots){const e=plot.environmental;if(!e)continue;
 const rows=await tx.$queryRaw<{version:number;payload:any}[]>`SELECT version,payload FROM "WorkRecord" WHERE workspace='reference' AND kind='regionalCropStandard' AND id=${e.standardId} FOR SHARE`;
 const data=await tx.$queryRaw<{version:number}[]>`SELECT version FROM "WorkRecord" WHERE workspace='shared' AND kind='climateNormals' AND id=${e.dataset.id} FOR SHARE`;
 if(rows[0]?.version!==e.standardVersion||rows[0]?.payload.status!=='REVIEWED'||data[0]?.version!==e.dataset.version)throw Error('작물 기준·기상 기준이 변경되었습니다. 환경 계획을 다시 생성하세요.');
 }
}
export function persistedEnvironmentWindow(task:AnnualPlan['plots'][number]['tasks'][number]){
 return {allowedWindows:task.allowedWindows??null};
}
export async function assertMissionEnvironmentReferences(tx:Prisma.TransactionClient,state:import('./types').State){
 const plots=state.missions.filter(m=>!isClosedTask(m.status)).map(m=>({environmental:(m as typeof m&{environmentReference?:AnnualPlan['plots'][number]['environmental']}).environmentReference})).filter(p=>p.environmental);
 await assertEnvironmentReferences(tx,{plots} as AnnualPlan);
}
