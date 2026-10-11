import {it,expect} from 'vitest';
import {planContinuousProduction,type Participation,type ProductionCriteria} from '../lib/continuous-production';
import {emptyCoordinationPolicy,type CoordinationContext} from '../lib/production-coordination';
import {catalogContext,catalogField,catalogState} from './catalog-fixtures';

it('changes a delegated crop through the common scheduler when an eligible regional specialty is configured, without paid inference',async()=>{
 const field=catalogField('potato');field.crop='';field.conditions!.climate.pepper='suitable';
 const participation:Participation={pnu:field.pnu,consultationId:field.consultationId!,receivedAt:'2026-10-03T00:00:00Z',status:'ACTIVE',term:{from:'2026-10-03',until:null,continuousConsent:true},changedAt:'2026-10-03T00:00:00Z',reason:'isolated test consent'};
 const criteria:ProductionCriteria={profiles:[{id:'test',name:'Synthetic work windows',context:catalogContext(),sourceBatchId:'isolated-crop30-test',dataOrigin:'DEMO'}]};
 const coordination:CoordinationContext={centerId:'demo',today:'2026-10-03',origin:'DEMO',contributions:[],policy:emptyCoordinationPolicy()};
 const input={fields:[field],participations:[participation],cycles:[],state:catalogState(),criteria,version:1,today:'2026-10-03',names:{},consentedPnus:[field.pnu],coordination};
 const baseline=await planContinuousProduction(input);
 expect(baseline.items[0].proposal?.cultivation.crop).toBe('potato');
 coordination.policy.specialties.push({centerId:'demo',crop:'pepper',status:'ESTABLISHED',bonus:4,sourceUrl:'https://example.com/isolated-specialty',method:'synthetic test only',checkedOn:'2026-01-01',validUntil:'2035-12-31'});
 const result=await planContinuousProduction(input),item=result.items[0];
 expect(item.status).toBe('REVIEW');expect(item.proposal?.cultivation.crop).toBe('pepper');
 expect(item.coordination?.specialtyBonus).toBe(4);expect(item.proposal!.dispatch.assignments.length).toBeGreaterThan(0);
 expect(item.decision?.inferenceCalled).toBe(false);expect(coordination.contributions).toEqual([]);expect(input.state.missions).toEqual([]);
});
