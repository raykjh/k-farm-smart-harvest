import {db} from '../lib/db';
import {centerRegistry} from '../lib/center-registry';
import {demoResourceState} from '../lib/registered-demo';
import {recordSpace} from '../lib/workspace';
import {resetFourCenterFixture,fourCenterTestUrl,fixtureDay as day} from './four-center-fixture';
import type {State} from '../lib/types';

// Input-only acceptance fixture. Exact windows, capacity, ownership and shared
// borders are test assumptions, not verified local agronomic or cadastral facts.
// No new missions, approved plans or model outputs are seeded.
export async function resetSubmissionJourney(){
 if(process.env.DATABASE_URL!==fourCenterTestUrl)throw Error('Disposable four-center DB required');
 await resetFourCenterFixture();
 for(const c of centerRegistry){
  const row=await db.center.findUniqueOrThrow({where:{id:c.id}}),state=row.state as unknown as State;
  state.ruleVersion='SUBMISSION_JOURNEY_ISOLATED_V1';
  state.machines=demoResourceState().machines.map(m=>({...m,id:m.id.replace('JB23',c.prefix),ownerCenterId:c.id})).filter(m=>c.id!=='demo'||!m.id.endsWith('CB02'));
  state.machines.forEach(m=>{if(m.id.includes('CB'))m.capacityHaHour=0.25});
  state.crewCapacity={operators:2,workers:c.id==='demo'?1:2};state.staffCount=state.crewCapacity.operators+state.crewCapacity.workers;
  const operator=state.operatorRoster![0];operator.kinds=['TR','RP','CB','DR','PS','PD','SP'];
  state.operatorRoster!.push({...operator,id:operator.id+'-spare',name:c.township+' 예비 운영자'});
  await db.center.update({where:{id:c.id},data:{state:JSON.parse(JSON.stringify(state))}});
  const key={workspace:recordSpace(c.id),kind:'productionCriteria',id:'current'};
  const criteria:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}})).payload;
  const operations=criteria.profiles[0].context.operations;
  Object.assign(operations.rice.harvest,{from:day('10-01'),to:day('10-01'),staff:2,rainSensitive:false});
  const windows:Record<string,Record<string,[string,string]>>={
   potato:{seed:['02-20','03-10'],soil:['03-11','03-20'],plant:['03-21','03-31'],harvest:['06-15','06-25'],finish:['06-15','06-30']},
   pepper:{seed:['02-15','02-28'],soil:['04-20','04-30'],plant:['05-05','05-15'],stake:['05-16','05-31'],harvest:['08-01','08-15'],finish:['08-01','08-20'],cleanup:['11-01','11-15']},
  };
  for(const [crop,rules] of Object.entries(windows))operations[crop]=Object.fromEntries(Object.entries(rules).map(([code,[from,to]])=>[code,{from:day(from),to:day(to),laborMinutesPer1000m2:crop==='potato'?30:120}]));
  criteria.profiles[0].name='계절별 작업 기준 · 격리 검증 입력';
  await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:criteria}});
 }
}

export const journeyParcels=[
 {pnu:'5274036023106160004',address:'전북특별자치도 장수군 계북면 농소리 616-4',area:'10000',land:'paddy'},
 {pnu:'5274036023110990001',address:'전북특별자치도 장수군 계북면 검증 필지',area:'1000',land:'upland'},
] as const;
