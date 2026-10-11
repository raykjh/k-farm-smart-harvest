import type {AnnualPlan} from './annual-plan';
import type {Dispatch} from './delegated-planning';
import type {Mission} from './types';
/** General-worker recruitment excludes equipment operators and the farmer's crew. */
export function ordinaryWorkerDemand(m:Pick<Mission,'owner'|'resourceId'|'staff'|'ordinaryWorkers'>){
 if(m.ordinaryWorkers!==undefined)return Number.isInteger(m.ordinaryWorkers)&&m.ordinaryWorkers>0?m.ordinaryWorkers:0;
 return !m.resourceId&&m.owner==='센터 인력'&&m.staff>0?m.staff:0;
}
export function operatingTaskCrew(task:AnnualPlan['plots'][number]['tasks'][number]):Pick<Mission,'machineOperators'|'ordinaryWorkers'|'farmerWorkers'>{
 if('crew' in task)return task.crew;
 const req=task.requirements;if(!req)return {};
 if(req.owner==='농부')return {machineOperators:0,ordinaryWorkers:0,farmerWorkers:Math.max(1,req.staff)};
 const staff=Math.max(1,req.staff),machineOperators=req.requiresOperator?1:0;
 return {machineOperators,ordinaryWorkers:staff-machineOperators,farmerWorkers:0};
}
/** Both individual and batch reservation paths use the same demand contract. */
export function plannedLaborDemand(plan:AnnualPlan,a:Dispatch['assignments'][number]){
 const plot=plan.plots.find(p=>p.pnu===a.pnu);
 if(!plot)throw Error('인력 수요의 농지·계획 연결이 없습니다.');
 const task=plot.tasks?.find(t=>t.id===a.taskId);if(!task)throw Error('인력 수요의 작업 연결이 없습니다.');
 const crew=operatingTaskCrew(task);
 return {missionId:a.taskId,cultivationId:plot.cultivationId,pnu:a.pnu,date:a.date,startMinute:a.startMinute,durationMinutes:a.durationMinutes,people:crew.ordinaryWorkers??a.staff,totalCenterStaff:a.staff,...crew,owner:a.owner,status:'UNASSIGNED',source:'COMMON_PLAN',note:'인력 수요만 저장. 모집·참석 확인·파견 확정 아님'};
}
