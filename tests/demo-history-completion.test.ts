import {it,expect} from 'vitest';
import {demoCompletionBatch} from '../lib/demo-history-completion';
import {replacementDurationFixture} from './replacement-duration-fixture';
import type {ExecutionView} from '../lib/execution-view';
import {buildWorkReport} from '../lib/work-report';
it('fills only past demo work, appends superseding evidence, and preserves actual/today/future/cancelled records',()=>{
 const {s,m}=replacementDurationFixture();s.fields[0].source='DEMO_ASSUMPTION';s.fields.push({...s.fields[0],id:'actual-field',source:'REGISTERED'});
 s.missions=[
  {...m,id:'past',scheduledDate:'2032-08-30'},
  {...m,id:'actual',fieldId:'actual-field',scheduledDate:'2032-08-30'},
  {...m,id:'protected',scheduledDate:'2032-08-30'},
  {...m,id:'today',scheduledDate:'2032-09-01'},
  {...m,id:'future',scheduledDate:'2032-09-02'},
  {...m,id:'cancelled',scheduledDate:'2032-08-30',status:'CANCELLED'},
 ];
 const evidence=[{recordId:'old',missionId:'past',plannedDate:'2032-08-30',source:'DEMO_SIMULATION',assessment:'SIMULATED_HELD'},{recordId:'actual-result',missionId:'protected',plannedDate:'2032-08-30',source:'ACTUAL',assessment:'HELD'}];
 const before=structuredClone(s),priorEvidence=structuredClone(evidence),now='2032-09-01T12:00:00Z';
 const batch=demoCompletionBatch(s,evidence,'2032-09-01',now);
 expect(s).toEqual(before);expect(evidence).toEqual(priorEvidence);expect(batch.records).toHaveLength(1);
 expect(batch.records[0].payload).toMatchObject({missionId:'past',source:'DEMO_SIMULATION',assessment:'SIMULATED_COMPLETED',actualStartedAt:null,actualFinishedAt:null,supersedesId:'old'});
 expect(batch.state.missions[0].status).toBe('COMPLETED');expect(batch.state.missions.slice(1)).toEqual(s.missions.slice(1));
 const updated=batch.records.map(r=>({...r.payload as ExecutionView,recordId:r.id,version:1,updatedAt:now}));
 const report=buildWorkReport(batch.state,updated,'2032-09-01');expect(report.rows[0]).toMatchObject({source:'SIMULATED',status:'COMPLETED',confirmed:true});
 expect(demoCompletionBatch(batch.state,[...updated,...evidence],'2032-09-01',now).records).toHaveLength(0);
});
it('does not manufacture future completion timestamps or invalid work durations',()=>{
 const {s,m}=replacementDurationFixture();s.fields[0].source='DEMO_ASSUMPTION';s.missions=[m];
 expect(()=>demoCompletionBatch(s,[],'2032-09-02','2032-08-01T00:00:00Z')).toThrow('미래');
 m.duration=999;expect(()=>demoCompletionBatch(s,[],'2032-09-02','2032-10-01T00:00:00Z')).toThrow('작업시간');
});
