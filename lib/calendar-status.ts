import {executionStatus,type ExecutionView} from './execution-view';
import type {State,Mission} from './types';
import {isClosedTask} from './task-lifecycle';
// Current action requirements are separate from closed daily results. Never invent execution.
export function calendarStatus(state:State,mission:Mission,history:ExecutionView[],today:string,date=mission.scheduledDate){
 const status=executionStatus(state,mission,history);
 if(isClosedTask(status))return status;
 if(status==='UNKNOWN')return 'RESULT_MISSING';
 if(status==='HELD'||!date)return 'REPLAN_PENDING';
 if(status==='UNSTAFFED')return 'STAFFING_PENDING';
 return date<today?'RESULT_MISSING':status;
}
export function inDailySchedule(state:State,mission:Mission,history:ExecutionView[],today:string){
 return !!mission.scheduledDate&&(mission.scheduledDate>=today||isClosedTask(executionStatus(state,mission,history)));
}
export type PendingApproval={id:string;missionIds:string[];day?:string;result:any};
