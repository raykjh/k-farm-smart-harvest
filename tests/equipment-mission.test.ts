import {it,expect} from 'vitest';
import {missionPacket,workAreaInput,type WorkArea} from '../lib/equipment-mission';
import {emptyCenter} from '../lib/center-registry';
import {missionReservation} from '../lib/plan-reservation-sync';
const fixture=()=>{
 const state=emptyCenter('demo');state.fields=[{id:'5274036023106160004',farmerId:'one',name:'test',address:'test',area:1000,crop:'쌀',mode:'완전 위탁형',confirmed:true,access:true,water:true,cluster:'',source:'REGISTERED'}];
 state.machines=[{id:'JB23DR01',name:'drone',type:'DR',status:'AVAILABLE',safetyLock:false,capacityHaHour:1,compatibleCrops:['rice']}];
 state.operatorRoster=[{id:'10000000-0000-4000-8000-000000000001',name:'operator',active:true,kinds:['DR'],weekdays:[0,1,2,3,4,5,6],from:'2027-01-01',until:'2027-12-31',excludedDates:[],startMinute:480,endMinute:960,evidence:'test only'}];
 state.missions=[{id:'mission',fieldId:state.fields[0].id,label:'test',crop:'쌀',scheduledDate:'2027-06-01',month:6,owner:'장비',status:'PLANNED',resourceId:'JB23DR01',start:0,duration:4,deadline:32,priority:1,batchKey:'test',staff:1,transport:1,machineOperators:1,operatorIds:[state.operatorRoster[0].id]}];
 const area:WorkArea={pnu:state.fields[0].id,geometry:{type:'Polygon',coordinates:[[[127,35],[127.01,35],[127.01,35.01],[127,35]]]},source:'OPERATOR_DRAWN',reviewedOn:'2026-10-03',accessAndExclusionsReviewed:true,machineAccessConfirmed:true,note:'field review test',version:1,reviewedBy:'tester'};
 const reservations=[missionReservation('demo',state.missions[0])!];return {state,area,reservations};
};
it('uses canonical field access instead of the legacy area flag, without skipping geometry review',()=>{
 const f=fixture();f.state.fields[0].machineAccess='yes';
 expect(missionPacket(f.state,'demo','mission',{...f.area,machineAccessConfirmed:false},f.reservations,'2026-10-03').ready).toBe(true);
 expect(missionPacket(f.state,'demo','mission',null,f.reservations,'2026-10-03').blockers).toContain('OPERATOR_REVIEWED_WORK_AREA_REQUIRED');
 for(const access of ['unknown','no'] as const){f.state.fields[0].machineAccess=access;expect(missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03').blockers).toContain('FIELD_ACCESS_REVIEW_REQUIRED')}
});
it('inherits an equipment operator but keeps qualification, shift and collision checks',()=>{
 const f=fixture();f.state.missions[0].operatorIds=[];f.state.machines[0].defaultOperatorId=f.state.operatorRoster![0].id;
 expect(missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03').ready).toBe(true);
 f.state.operatorRoster![0].active=false;expect(missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03').ready).toBe(false);f.state.operatorRoster![0].active=true;
 f.state.missions.push({...f.state.missions[0],id:'overlap'});expect(missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03').blockers).toContain('OPERATOR_BOOKING_CONFLICT');
});
it('prepares bounded equipment data without ever authorizing hardware execution',()=>{
 const f=fixture(),r=missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03');expect(r.ready).toBe(true);expect(r.data).toMatchObject({executionAuthorized:false,transport:'LOCAL_ADAPTER_ONLY',fieldId:f.area.pnu});expect(r.data.executionChecks).toContain('EMERGENCY_STOP_AND_GEOFENCE');
});
it('requires a separately reviewed work polygon, qualified operator and matching booking',()=>{
 const f=fixture();expect(missionPacket(f.state,'demo','mission',null,f.reservations,'2026-10-03').blockers).toContain('OPERATOR_REVIEWED_WORK_AREA_REQUIRED');
 f.state.operatorRoster=[];expect(missionPacket(f.state,'demo','mission',f.area,[],'2026-10-03').blockers).toEqual(expect.arrayContaining(['NAMED_QUALIFIED_OPERATOR_REQUIRED','MATCHING_RESERVATION_REQUIRED']));
 expect(()=>workAreaInput.parse({...f.area,source:'CADASTRAL_AUTOMATIC'})).toThrow();
});
it('invalidates stale work packets on equipment failure, area correction, schedule change and safety lock',()=>{
 const f=fixture(),before=missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03');
 f.state.machines[0].safetyLock=true;const locked=missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03');expect(locked.ready).toBe(false);expect(locked.fingerprint).not.toBe(before.fingerprint);
 f.state.machines[0].safetyLock=false;f.state.missions[0].scheduledDate='2027-06-02';expect(missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03').blockers).toContain('MATCHING_RESERVATION_REQUIRED');
});
it('keeps unrelated changes from invalidating a packet and never emits an executable packet for missing work',()=>{
 const f=fixture(),before=missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03');f.state.planVersion++;
 expect(missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03').fingerprint).toBe(before.fingerprint);
 expect(missionPacket(f.state,'demo','unknown',null,[],'2026-10-03').ready).toBe(false);
});
it('requires explicit access review and never marks registration or ownership as approved',()=>{
 const f=fixture();f.state.fields[0].confirmed=false;f.state.fields[0].access=false;
 const before=structuredClone(f.state.fields[0]);
 expect(missionPacket(f.state,'demo','mission',{...f.area,machineAccessConfirmed:false},f.reservations,'2026-10-03').blockers).toContain('FIELD_ACCESS_REVIEW_REQUIRED');
 expect(missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03').ready).toBe(true);
 expect(f.state.fields[0]).toEqual(before);
 const {machineAccessConfirmed,version,reviewedBy,...legacy}=f.area;
 expect(workAreaInput.parse(legacy).machineAccessConfirmed).toBe(false);
});
it('blocks equipment packets while an unresolved labor absence needs recovery',()=>{
 const f=fixture(),before=missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03');
 f.state.missions[0].laborRecoveryRequired=true;
 const blocked=missionPacket(f.state,'demo','mission',f.area,f.reservations,'2026-10-03');
 expect(blocked.ready).toBe(false);expect(blocked.blockers).toContain('LABOR_RECOVERY_REQUIRED');
 expect(blocked.fingerprint).not.toBe(before.fingerprint);
});
