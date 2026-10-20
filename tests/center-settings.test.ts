import {it,expect,vi,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as engine from '../lib/scheduling-engine';
import {calculateCurrentSchedule} from './current-solver';
import type {NamedOperator} from '../lib/named-operators';
import {db} from '../lib/db';
import {emptyCenter} from '../lib/center-registry';
import {centerSettingCommand} from '../lib/center-settings';
import {saveCenterSetting,centerSettingsKey} from '../lib/center-settings-store';
import {installCenterDemo,centerDemoCriteria} from '../lib/center-demo-fixture';
import {permitted} from '../lib/auth-policy';
import {testPrincipal} from './auth-fixture';
import {recordSpace} from '../lib/workspace';
import {buildAnnualPlan} from '../lib/annual-plan';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import type {State} from '../lib/types';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const proof={basis:'격리 테스트 입력',checkedOn:'2026-10-02'};
afterEach(()=>vi.restoreAllMocks());
it('binds names to fixed future work and rejects roster conflicts without altering records or history',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('test DB required');
 vi.spyOn(engine,'solveSchedule').mockImplementation(calculateCurrentSchedule);
 const rollback=new Error('rollback');
 await expect(db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:recordSpace('janggye'),kind:'centerSettings'}});
  const state=emptyCenter('janggye');state.staffCount=4;state.transportCount=2;
  const task={id:'operator-future',fieldId:'isolated',label:'확정 작업',crop:'쌀',status:'PLANNED',scheduledDate:'2034-05-01',month:5,owner:'장비',resourceId:'TESTTR01',staff:1,machineOperators:1,ordinaryWorkers:0,transport:1,start:0,duration:4,deadline:32,priority:1,batchKey:'isolated'} as State['missions'][number];
  state.missions=[task,{...task,id:'past',status:'COMPLETED',scheduledDate:'2025-05-01'}];
  await tx.center.upsert({where:{id:'janggye'},create:{id:'janggye',version:0,state:json(state)},update:{version:0,state:json(state)}});
  const person:NamedOperator={id:randomUUID(),name:'검증운영자',active:true,kinds:['TR'],weekdays:[0,1,2,3,4,5,6],from:'2034-01-01',until:'2034-12-31',excludedDates:[],startMinute:480,endMinute:960,evidence:'격리 테스트 근무표'};
  const a=await saveCenterSetting(tx,'janggye','test',{action:'operators',operators:[person],version:0,settingsVersion:0});
  const before=await tx.center.findUniqueOrThrow({where:{id:'janggye'}}),settings=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:centerSettingsKey('janggye')}}),audits=await tx.audit.count();
  expect((before.state as unknown as State).missions).toEqual([{...task,operatorIds:[person.id]},state.missions[1]]);
  await expect(saveCenterSetting(tx,'janggye','test',{action:'operators',operators:[{...person,excludedDates:['2034-05-01']}],version:a.version,settingsVersion:a.settingsVersion})).rejects.toThrow('기존 확정 작업');
  await expect(saveCenterSetting(tx,'janggye','test',{action:'operators',operators:[person],version:0,settingsVersion:0})).rejects.toThrow('변경되었습니다');
  expect(await tx.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(before);expect(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:centerSettingsKey('janggye')}})).toEqual(settings);expect(await tx.audit.count()).toBe(audits);
  throw rollback;
 },{timeout:30000})).rejects.toBe(rollback);
});
it('settings are scoped to a known center and only its administrator can write',()=>{
 expect(permitted({...testPrincipal,centerId:'janggye'},'center-settings','POST',{})).toBe(true);
 expect(permitted({...testPrincipal,role:'CENTER_STAFF',centerId:'janggye'},'center-settings','POST',{})).toBe(true);
 expect(permitted({...testPrincipal,role:'SUPER_ADMIN',centerId:null},'center-settings','GET',{})).toBe(false);
 expect(centerSettingCommand.safeParse({action:'capacity',version:0,settingsVersion:0,staffCount:1.5,transportCount:1,evidence:proof}).success).toBe(false);
 expect(centerSettingCommand.safeParse({action:'capacity',version:0,settingsVersion:0,staffCount:5,transportCount:1,crewCapacity:{operators:3,workers:3},evidence:proof}).success).toBe(false);
 expect(centerSettingCommand.safeParse({action:'location',version:0,settingsVersion:0,location:{longitude:127.6,latitude:35.7,nx:80,sourceUrl:'https://www.vworld.kr',evidence:proof}}).success).toBe(false);
});
it('persists qualified crew limits and refuses to invalidate approved work or remove limits by omission',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('test DB required');
 const rollback=new Error('rollback');
 await expect(db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:recordSpace('janggye'),kind:'centerSettings'}});
  const state=emptyCenter('janggye');state.staffCount=6;state.transportCount=2;
  state.missions=[{id:'qualified-existing',fieldId:'isolated',label:'기존 작업',crop:'쌀',status:'PLANNED',scheduledDate:'2034-05-01',month:5,owner:'장비',resourceId:'TESTTR01',staff:2,machineOperators:1,ordinaryWorkers:1,transport:1,start:0,duration:4,deadline:32,priority:1,batchKey:'isolated'}];
  await tx.center.upsert({where:{id:'janggye'},create:{id:'janggye',version:0,state:json(state)},update:{version:0,state:json(state)}});
  const a=await saveCenterSetting(tx,'janggye','test',{action:'capacity',version:0,settingsVersion:0,staffCount:6,transportCount:2,crewCapacity:{operators:1,workers:3},evidence:proof});
  const before=await tx.center.findUniqueOrThrow({where:{id:'janggye'}}),settings=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:centerSettingsKey('janggye')}});
  await expect(saveCenterSetting(tx,'janggye','test',{action:'capacity',version:a.version,settingsVersion:a.settingsVersion,staffCount:6,transportCount:2,crewCapacity:{operators:0,workers:4},evidence:proof})).rejects.toThrow('기존 미완료');
  expect(await tx.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(before);
  expect(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:centerSettingsKey('janggye')}})).toEqual(settings);
  await saveCenterSetting(tx,'janggye','test',{action:'capacity',version:a.version,settingsVersion:a.settingsVersion,staffCount:6,transportCount:2,evidence:proof});
  const after=await tx.center.findUniqueOrThrow({where:{id:'janggye'}});expect(after.state).toMatchObject({crewCapacity:{operators:1,workers:3},missions:state.missions});
  expect((await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:centerSettingsKey('janggye')}})).payload).toMatchObject({capacity:{crewCapacity:{operators:1,workers:3},evidence:{reviewer:'test'}}});
  throw rollback;
 },{timeout:30000})).rejects.toBe(rollback);
});
it('saves settings with optimistic concurrency, rejects unavailable data and preserves old work',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('test DB required');
 const rollback=new Error('rollback');
 await expect(db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:recordSpace('janggye'),kind:'centerSettings'}});
  const state=emptyCenter('janggye');await tx.center.upsert({where:{id:'janggye'},create:{id:'janggye',version:0,state:json(state)},update:{version:0,state:json(state)}});
  const a=await saveCenterSetting(tx,'janggye','test',{action:'capacity',version:0,settingsVersion:0,staffCount:6,transportCount:2,evidence:proof});
  await expect(saveCenterSetting(tx,'janggye','test',{action:'capacity',version:0,settingsVersion:0,staffCount:8,transportCount:2,evidence:proof})).rejects.toThrow('변경되었습니다');
  await expect(saveCenterSetting(tx,'janggye','test',{action:'climate',version:a.version,settingsVersion:a.settingsVersion,climate:{datasetId:'absent',datasetVersion:1,evidence:proof}})).rejects.toThrow('평년자료가');
  await saveCenterSetting(tx,'janggye','test',{action:'location',version:a.version,settingsVersion:a.settingsVersion,location:{longitude:127.61,latitude:35.71,sourceUrl:'https://www.vworld.kr',evidence:proof}});
  const row=await tx.center.findUniqueOrThrow({where:{id:'janggye'}});expect(row.state).toMatchObject({staffCount:6,transportCount:2,missions:[],fields:[]});
  const stored=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:centerSettingsKey('janggye')}});expect(stored.payload).toMatchObject({capacity:{evidence:{reviewer:'test'}},location:{longitude:127.61}});
  throw rollback;
 },{timeout:30000})).rejects.toBe(rollback);
});
it('demo inputs use real planning types, install once, and refuse to overwrite existing resources',async()=>{
 const criteria=centerDemoCriteria('gyenam');expect(criteria.profiles.map(p=>p.context.region)).toEqual(['계남면','계남면']);
 const rollback=new Error('rollback');
 await expect(db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:recordSpace('gyenam')}});
  await tx.center.upsert({where:{id:'gyenam'},create:{id:'gyenam',version:0,state:json(emptyCenter('gyenam'))},update:{version:0,state:json(emptyCenter('gyenam'))}});
  const geo={name:'계남면',code:'52740350',longitude:127.58,latitude:35.69,geometry:{type:'Polygon',coordinates:[]},sourceUrl:'https://www.vworld.kr',fetchedAt:new Date().toISOString()};
  expect(await installCenterDemo(tx,'gyenam',geo)).toMatchObject({equipment:16,crew:6,transport:2});
  const after=await tx.center.findUniqueOrThrow({where:{id:'gyenam'}});
  for(const crop of ['rice','potato','pepper'] as const){const plan=buildAnnualPlan([{pnu:'5274035023100010001',address:'격리 농지',crop,group:'',area:1000,mode:'full',rights:'pending'}],2027,1,criteria.profiles[1].context),dispatch=(await previewAnnualDispatch(plan,after.state as unknown as State,'2026-10-02'));
   const required=plan.plots[0].tasks.filter(t=>t.kind==='PROCESS'||t.kind==='REPEAT');expect(dispatch.assignments.map(a=>a.taskId)).toEqual(expect.arrayContaining(required.map(t=>t.id)));
   if(crop==='pepper')expect(required.filter(t=>t.operationCode==='harvest')).toHaveLength(3);
  }
  expect(await installCenterDemo(tx,'gyenam',geo)).toEqual({id:'gyenam',unchanged:true});expect(await tx.center.findUniqueOrThrow({where:{id:'gyenam'}})).toEqual(after);
  await tx.workRecord.deleteMany({where:{workspace:recordSpace('gyenam'),kind:'demoResourceBatch'}});
  await expect(installCenterDemo(tx,'gyenam',geo)).rejects.toThrow('덮어쓰지');throw rollback;
 },{timeout:30000})).rejects.toBe(rollback);
});
