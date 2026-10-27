import {jointSource} from './integrated-plan-fixture';
import {applyPermanentWorkforce,type PermanentWorkforce} from '../lib/permanent-workforce';
import {emptyLaborOps,type Worker} from '../lib/labor-operations';

export function portfolioSource(kind:'production-target'|'harvest-collision',areas=[650,1350,1050]){
 const s=jointSource('demo',areas.length);s.today='2026-10-27';s.coordination.today=s.today;
 // readProductionSource narrows persisted origins to REGISTERED. This fixture
 // is synthetic and never persisted; retain DEMO provenance in its calculations.
 Object.assign(s.coordination,{origin:'DEMO'});
 s.fields.forEach((f,i)=>f.area=areas[i]);
 for(const p of s.criteria.profiles)p.dataOrigin='DEMO';
 const ref={sourceUrl:'https://example.org/kfarm/synthetic-portfolio-validation',method:'SYNTHETIC TEST ONLY',checkedOn:'2026-01-01',validUntil:'2027-12-31'};
 s.coordination.policy.yields=[{crop:'potato',commodity:'POTATO',kgPer1000m2:{low:1000,high:1200},...ref},{crop:'pepper',commodity:'DRIED_RED_PEPPER',kgPer1000m2:{low:200,high:250},...ref}];
 s.coordination.policy.planningLimits=kind==='production-target'?[{id:'synthetic-potato-target',version:'synthetic-v1',commodity:'POTATO',crops:['potato'],centerIds:['demo'],origin:'DEMO',from:'2027-01-01',to:'2027-12-31',maxKg:2100,mode:'HARD',basis:'REVIEWED_PARTICIPANT_TARGET',sourceKind:'SYNTHETIC',sourceUrl:ref.sourceUrl,checkedOn:ref.checkedOn,validUntil:ref.validUntil}]:[];
 const id=(n:number)=>`61000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const ops=emptyLaborOps();ops.people=Array.from({length:50},(_,i)=>({id:id(i),name:`Synthetic worker ${i}`,active:true,employment:'VOLUNTEER'} as Worker));
 const roster:PermanentWorkforce={version:'permanent-workforce-v1',checkedOn:'2026-01-01',evidenceRef:'SYNTHETIC reviewed calendar',workers:Array.from({length:5},(_,i)=>({workerId:id(i),role:i<2?'OPERATOR':'WORKER',...(i<2?{operatorId:id(100+i)}:{}),from:'2026-01-01',to:'2027-12-31',weekdays:[0,1,2,3,4,5,6],startMinute:480,endMinute:960,excludedDates:[]}))};
 s.state!.operatorRoster=[0,1].map(i=>({id:id(100+i),name:`Synthetic operator ${i}`,active:true,kinds:['DR','TR','RP','PS','CB','PD','SP','TV','SE','GC','RD','SD','HV'],weekdays:[0,1,2,3,4,5,6],from:'2026-01-01',until:'2027-12-31',startMinute:480,endMinute:960,excludedDates:[],evidence:'SYNTHETIC reviewed qualification'}));
 s.state=applyPermanentWorkforce(s.state!,roster,ops,s.today);
 if(kind==='harvest-collision'){
  const harvest=s.criteria.profiles[0].context.operations!.potato!.harvest;
  harvest.from='2027-05-10';harvest.to='2027-05-10';
  for(const m of s.state.machines)if(m.id.includes('PD'))m.capacityHaHour=0.022;
 }
 return s;
}
