import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {seedSplitWorkAreas} from './split-work-area-fixture';
import {GET,POST} from '../app/api/equipment-missions/route';
import type {WorkMission} from '../lib/replan-work-split';
it('migrates reviewed identities atomically, preserves previous rows and requires fresh geometry review',async()=>{
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),admin=await testSession(),staff=await testSession('CENTER_STAFF'),foreign=await testSession('CENTER_ADMIN','janggye');
 const call=async(s:typeof admin,b?:object,status=200)=>{const r=await (b?POST:GET)(new NextRequest('http://127.0.0.1:3100/api/equipment-missions',{method:b?'POST':'GET',headers:s.headers,...(b?{body:JSON.stringify(b)}:{})})),d=await r.json();expect(r.status,JSON.stringify(d)).toBe(status);return d};
 try{
  for(const [i,m] of (f.parts as WorkMission[]).entries()){delete m.equipmentSplit;delete m.equipmentWork;delete m.splitChildIds;m.operationKey='legacy:soil'+(i?':part2':'');}
  await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(f.state))}});
  const before=await db.workRecord.findMany({where:{kind:'resourceReservation'},orderBy:{id:'asc'}});
  const group=(await call(admin)).legacyGroups[0];expect(group.editable).toBe(true);
  const b={action:'linkLegacyParts',review:{key:group.key,fingerprint:group.fingerprint,note:'격리 검증: 승인 작업량과 회차 확인',confirmed:true,parts:f.parts.map(m=>({missionId:m.id,workAreaM2:5000,setupMinutes:60}))}};
  await call(staff,b,403);await call(foreign,b,409);
  const results=await Promise.all([0,1].map(()=>POST(new NextRequest('http://127.0.0.1:3100/api/equipment-missions',{method:'POST',headers:admin.headers,body:JSON.stringify(b)}))));
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const next=await call(admin);expect(next.legacyGroups).toEqual([]);expect(next.groups).toHaveLength(1);expect(next.groups[0].ready).toBe(false);
  expect(await db.workRecord.findMany({where:{kind:'resourceReservation'},orderBy:{id:'asc'}})).toEqual(before);
  const history=await db.workRecord.findMany({where:{kind:'workPartLinkHistory'}});expect(history).toHaveLength(2);
  for(const row of history)expect((row.payload as any).before).toEqual(f.parts.find(m=>m.id===(row.payload as any).before.id));
  expect(next.tasks.every((t:any)=>!t.ready&&t.data.workArea===null)).toBe(true);
 }finally{await admin.cleanup();await staff.cleanup();await foreign.cleanup();await f.cleanup();await base.cleanup();}
});
