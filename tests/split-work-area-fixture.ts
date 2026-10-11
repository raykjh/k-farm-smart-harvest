import {replacementDurationFixture,replacementDay} from './replacement-duration-fixture';
import {splitReplanWork} from '../lib/replan-work-split';
import {missionReservation} from '../lib/plan-reservation-sync';
import {dateSlot} from '../lib/scheduling-engine';
import {splitReviewFingerprint,type SplitWorkArea} from '../lib/split-work-area';
import type {WorkGeometry} from '../lib/work-area-geometry';
import type {WorkArea} from '../lib/equipment-mission';
import {db} from '../lib/db';
export const box=(x1=127,y1=35,x2=127.001,y2=35.001):WorkGeometry=>({type:'Polygon',coordinates:[[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]]]});
export function splitWorkAreaFixture(){
 const f=replacementDurationFixture();
 f.s.fields[0].id='5274036023106160004';f.s.fields[0].address='계북면 격리 검증 농지';for(const m of f.s.missions)m.fieldId=f.s.fields[0].id;
 const {state,splits}=splitReplanWork(f.s,{ids:['work'],scope:'PRESERVE'},replacementDay),groupId=splits[0].partIds.map(id=>state.missions.find(m=>m.id===id) as any)[0].equipmentSplit.groupId;
 // Apply the same approved split shape to a small isolated fixture. Full solver approval is covered separately.
 state.machines=[{...f.s.machines[0],capacityHaHour:0.1,status:'AVAILABLE'}];delete state.centerSharing;
 const parts=splits[0].partIds.map((id,i)=>{const m=state.missions.find(m=>m.id===id)!;m.status='PLANNED';m.resourceId=state.machines[0].id;m.scheduledDate=`2032-09-0${i+1}`;m.start=dateSlot(m.scheduledDate)-dateSlot('2026-09-09');m.duration=24;(m as import('../lib/replan-work-split').WorkMission).planningWindow!.duration=24;m.operatorIds=[f.operator];return m});
 const area:WorkArea={pnu:state.fields[0].id,geometry:box(),source:'FIELD_SURVEY',reviewedOn:'2026-10-01',note:'격리 현장 구역 검증',accessAndExclusionsReviewed:true,machineAccessConfirmed:true,version:1,reviewedBy:'fixture'};
 const input={groupId,source:'OPERATOR_DRAWN' as const,reviewedOn:'2026-10-03',note:'격리 분할 구역 확인',accessAndExclusionsReviewed:true as const,parts:parts.map((m,i)=>({missionId:m.id,geometry:box(127+i*0.0005,35,127+(i+1)*0.0005,35.001)}))};
 const saved:SplitWorkArea={...input,version:1,parentVersion:1,reviewFingerprint:splitReviewFingerprint(state,groupId,area),reviewedBy:'fixture',savedAt:'2026-10-03T00:00:00Z'};
 return {state,area,input,saved,groupId,parts,reservations:parts.map(m=>missionReservation('demo',m)!)};
}
export const areaKinds=['workArea','workAreaHistory','splitWorkArea','splitWorkAreaHistory','equipmentMission','equipmentMissionHistory','workPartLinkHistory'];
export async function seedSplitWorkAreas(){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated PostgreSQL only');
 const prior=await db.workRecord.findMany({where:{kind:{in:areaKinds}}}),f=splitWorkAreaFixture();
 await db.workRecord.deleteMany({where:{kind:{in:areaKinds}}});
 await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(f.state))}});
 for(const r of f.reservations)await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:r.id,payload:JSON.parse(JSON.stringify(r))}});
 return {...f,cleanup:async()=>{await db.workRecord.deleteMany({where:{kind:{in:areaKinds}}});if(prior.length)await db.workRecord.createMany({data:prior as any});}};
}
