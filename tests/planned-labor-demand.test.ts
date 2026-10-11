import {it,expect} from 'vitest';
import {plannedLaborDemand} from '../lib/planned-labor-demand';
it('preserves common task identity and staffing without claiming attendance',()=>{
 const a={taskId:'job',pnu:'pnu',date:'2026-10-01',startMinute:480,durationMinutes:60,staff:3,owner:'센터 인력'};
 const plan={plots:[{pnu:'pnu',cultivationId:'cycle',tasks:[{id:'job'}]}]} as any;
 expect(plannedLaborDemand(plan,a)).toMatchObject({missionId:'job',cultivationId:'cycle',people:3,source:'COMMON_PLAN',status:'UNASSIGNED'});
 expect(()=>plannedLaborDemand({plots:[]} as any,a)).toThrow();
 expect(()=>plannedLaborDemand({plots:[{pnu:'pnu',cultivationId:'cycle'}]} as any,a)).toThrow('작업 연결');
 plan.plots[0].tasks[0].crew={machineOperators:1,ordinaryWorkers:2,farmerWorkers:0};
 expect(plannedLaborDemand(plan,a)).toMatchObject({people:2,totalCenterStaff:3,machineOperators:1,ordinaryWorkers:2});
});
