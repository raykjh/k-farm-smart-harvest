import {expect,it} from 'vitest';
import {inspectDemoRemoval} from '../lib/demo-removal-preflight';
import {clearedState} from '../lib/demo-data';
import {demoRemovalFixture} from './demo-removal-fixture';

it('allows only an unmodified manifest-backed batch without downstream records',()=>{
 const {b,snapshot}=demoRemovalFixture();
 expect(inspectDemoRemoval(b.state,snapshot)).toMatchObject({safe:true,fields:30,tasks:460,blockers:[]});
 const manual={workspace:'sandbox',kind:'consultation',id:'manual',version:1,payload:{farmer:{name:'수동 입력'}}};
 snapshot.records.push(manual,{workspace:'sandbox',kind:'centerSettings',id:'current',version:1,payload:{location:null}});
 expect(inspectDemoRemoval(b.state,snapshot).safe).toBe(true);
 expect(snapshot.records).toContain(manual);
});

it.each(['missing manifest','changed consultation payload without a version bump','changed farmer linkage'])(
 'blocks %s',change=>{
  const {b,snapshot}=demoRemovalFixture();
  if(change==='missing manifest')snapshot.records.shift();
  else if(change.startsWith('changed consultation'))(snapshot.records[2].payload as any).farmer.phone='000-0000-9999';
  else b.state.fields[0].farmerId='a-different-farmer';
  expect(inspectDemoRemoval(b.state,snapshot)).toMatchObject({safe:false,blockers:expect.arrayContaining([expect.objectContaining({code:'REGISTRATION_CHANGED'})])});
 });

it.each(['cultivation','taskExecutionAssessment','taskPlanChange','laborOperations','automaticReplan','unknownFutureWorkflow'])(
 'retains %s and blocks aggregate-only removal',kind=>{
  const {b,snapshot}=demoRemovalFixture();snapshot.records.push({workspace:'sandbox',kind,id:'linked',version:1,payload:{taskId:b.state.missions[0].id}});
  expect(inspectDemoRemoval(b.state,snapshot)).toMatchObject({safe:false,blockers:expect.arrayContaining([expect.objectContaining({code:'WORKFLOW',count:1})])});
 });

it('detects loans, foreign-center tasks, reports, notices and old idempotency receipts',()=>{
 const {b,snapshot}=demoRemovalFixture(),m=b.state.machines[0].id;
 snapshot.records.push(
  {workspace:'shared',kind:'equipmentLoan',id:'loan',version:1,payload:{ownerCenterId:'demo',borrowerCenterId:'gyenam',machineId:m}},
  {workspace:'shared',kind:'resourceReservation',id:'reservation',version:1,payload:{centerId:'gyenam',resourceId:'demo:'+m}},
  {workspace:'center:gyenam',kind:'laborShareNotice',id:'notice',version:1,payload:{taskId:b.state.missions[0].id}},
  {workspace:'reports',kind:'confirmedReport',id:'report',version:1,payload:{totals:{completed:1}}},
 );
 snapshot.otherCenters.push({id:'gyenam',version:2,state:{missions:[{resourceId:m}]}});
 snapshot.outbox.push({id:'notice',centerId:'demo',farmerId:b.state.fields[0].farmerId,status:'DELIVERED'});
 snapshot.receipts.push({id:'old-result',operation:'plan',result:{version:1}});
 const result=inspectDemoRemoval(b.state,snapshot);
 expect(result.safe).toBe(false);
 expect(Object.fromEntries(result.blockers.map(b=>[b.code,b.count]))).toEqual({SHARED:2,OTHER_CENTER:2,REPORT:1,NOTICE:1,RECEIPT:1});
});

it('does not count unrelated other-center records or weather as demo descendants',()=>{
 const {b,snapshot}=demoRemovalFixture();snapshot.records.push(
  {workspace:'shared',kind:'weatherHourly',id:'weather',version:1,payload:{centerId:'demo'}},
  {workspace:'shared',kind:'equipmentLoan',id:'elsewhere',version:1,payload:{ownerCenterId:'janggye',borrowerCenterId:'cheoncheon',machineId:'unique-machine'}},
 );
 snapshot.receipts.push({id:'gyenam:other-receipt',operation:'plan',result:{version:1}});
 expect(inspectDemoRemoval(b.state,snapshot).safe).toBe(true);
});

it('changes the confirmation token on connected-record edits even when the center aggregate is unchanged',()=>{
 const {b,snapshot}=demoRemovalFixture();const first=inspectDemoRemoval(b.state,snapshot).token;
 snapshot.centerVersion++;expect(inspectDemoRemoval(b.state,snapshot).token).not.toBe(first);
 const next=inspectDemoRemoval(b.state,snapshot).token;snapshot.records[2].version++;
 expect(inspectDemoRemoval(b.state,snapshot).token).not.toBe(next);
});

it('blocks leftover workflow records even when the aggregate has already been emptied',()=>{
 expect(inspectDemoRemoval(clearedState(),{centerVersion:1,records:[{workspace:'sandbox',kind:'cultivation',id:'orphan',version:1,payload:{}}],outbox:[],receipts:[],otherCenters:[]}).safe).toBe(false);
});
