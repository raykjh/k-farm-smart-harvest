import {demoRemovalFixture} from './demo-removal-fixture';
import type {RetirementSnapshot} from '../lib/demo-retirement';
export function retirementFixture(){
 const {b,snapshot:s}=demoRemovalFixture(),mission=b.state.missions.find(m=>m.resourceId)!;
 const record=(kind:string,id:string,payload:unknown,workspace='sandbox')=>JSON.stringify({workspace,kind,id,version:1,payload});
 const snapshot:RetirementSnapshot={centers:[JSON.stringify({id:'demo',version:1,state:b.state})],records:s.records.map(r=>JSON.stringify(r)),outbox:[],receipts:[]};
 snapshot.records.push(record('taskExecutionAssessment','completed',{source:'DEMO_SIMULATION',missionId:mission.id}),record('cultivation','cycle',{id:'cycle',pnu:mission.fieldId,source:'LEGACY_IMPORT'}),record('cultivationPlan','cycle',{plots:[{pnu:mission.fieldId,cultivationId:'cycle'}]}),record('resourceReservation','reservation',{centerId:'demo',taskId:mission.id,resourceId:mission.resourceId},'shared'),record('manual-note','keep',{text:'Unrelated manual record'}));
 snapshot.outbox.push(JSON.stringify({id:'notice',centerId:'demo',farmerId:b.state.fields[0].farmerId,status:'DELIVERED'}));
 return {b,snapshot,record,mission};
}
