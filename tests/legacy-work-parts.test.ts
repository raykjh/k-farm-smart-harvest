import {it,expect} from 'vitest';
import {legacyWorkGroups,linkLegacyWorkParts} from '../lib/legacy-work-parts';
import {splitWorkAreaFixture} from './split-work-area-fixture';
import {splitGroup} from '../lib/split-work-area';
import type {WorkMission} from '../lib/replan-work-split';
function fixture(){
 const f=splitWorkAreaFixture();
 for(const [i,m] of (f.parts as WorkMission[]).entries()){
  delete m.equipmentSplit;delete m.splitChildIds;delete m.equipmentWork;
  m.operationKey='cultivation:test:soil'+(i?':part2':'')+':replacement:fixed';
 }
 const group=legacyWorkGroups(f.state)[0];
 return {...f,group,input:{key:group.key,fingerprint:group.fingerprint,note:'기존 승인 작업량을 현장자료와 대조',confirmed:true as const,parts:f.parts.map(m=>({missionId:m.id,workAreaM2:5000,setupMinutes:60}))}};
}
it('links explicit legacy parts with an operator review without changing dates, resources or completion',()=>{
 const f=fixture(),before=structuredClone(f.state),r=linkLegacyWorkParts(f.state,f.input),g=splitGroup(r.state,r.groupId);
 expect(g.members).toHaveLength(2);expect(f.state).toEqual(before);
 for(const m of g.members){const old=before.missions.find(t=>t.id===m.id)!;expect(m.scheduledDate).toBe(old.scheduledDate);expect(m.duration).toBe(old.duration);expect(m.resourceId).toBe(old.resourceId);expect(m.status).toBe(old.status);expect(m.equipmentWork?.areaHa).toBe(.5);}
 expect(legacyWorkGroups(r.state)).toEqual([]);
});
it('refuses incomplete, completed, duplicate, stale, overloaded or foreign member reviews',()=>{
 const f=fixture();
 expect(()=>linkLegacyWorkParts(f.state,{...f.input,fingerprint:'a'.repeat(64)})).toThrow('변경');
 expect(()=>linkLegacyWorkParts(f.state,{...f.input,parts:[f.input.parts[0],f.input.parts[0]]})).toThrow('모든');
 expect(()=>linkLegacyWorkParts(f.state,{...f.input,parts:f.input.parts.map(p=>({...p,workAreaM2:100000}))})).toThrow('초과');
 expect(()=>linkLegacyWorkParts(f.state,{...f.input,parts:[f.input.parts[0],{...f.input.parts[1],missionId:'foreign'}]})).toThrow('모든');
 f.parts[0].status='COMPLETED';expect(legacyWorkGroups(f.state)[0].editable).toBe(false);
 expect(()=>linkLegacyWorkParts(f.state,f.input)).toThrow('이관');
 f.state.missions=f.state.missions.filter(m=>m.id!==f.parts[0].id);expect(legacyWorkGroups(f.state)[0].editable).toBe(false);
});
