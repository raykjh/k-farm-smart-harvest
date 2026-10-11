import {describe,it,expect,beforeEach,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {initialState,annualMissions} from '../lib/seed';
import {recommend} from '../lib/recommend';
import {snapshot,validate,jobs} from '../lib/scheduler';
import * as service from '../lib/service';
import {asPrincipal} from '../lib/auth';
import {testPrincipal} from './auth-fixture';
const api={...service,approve:(...args:Parameters<typeof service.approve>)=>asPrincipal(testPrincipal,()=>service.approve(...args))};
import type {State} from '../lib/types';
// Uses isolated local demo database only. Never run with production credentials.
beforeEach(async()=>{
 if(process.env.DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_test')throw new Error('Tests require isolated local test database');
 await db.$transaction([db.outbox.deleteMany(),db.receipt.deleteMany(),db.audit.deleteMany(),db.center.deleteMany(),db.center.create({data:{id:'demo',state:initialState()}})]);
});
afterAll(async()=>{await db.$disconnect()});
async function prepare(){await api.register(randomUUID(),'A',3000,true,true,true);await api.choose(randomUUID(),[{fieldId:'A',crop:'쌀',mode:'공동참여형'},{fieldId:'B',crop:'감자',mode:'완전 위탁형'},{fieldId:'C',crop:'고추',mode:'공동참여형'}]);await api.plan(randomUUID());}
describe('first vertical slice',()=>{
 it('register → recommend → plan → wind → replan → batch apply → retry notification',async()=>{
  await prepare();let {state:s}=await api.read();const groundStart=s.missions.find(m=>m.id==='B-2')!.start;expect(s.missions).toHaveLength(546);expect(new Set(s.missions.map(m=>m.id)).size).toBe(546);validate(s);
  await api.wind(randomUUID());const result=await api.replan(randomUUID()) as {revisionId:string};
  s=(await api.read()).state;expect(s.planVersion).toBe(1);expect(s.revisions[0].status).toBe('REVIEW_REQUIRED');expect(s.revisions[0].diff.length).toBeGreaterThan(0);
  const key=randomUUID();await api.approve(key,result.revisionId);await api.approve(key,result.revisionId);await api.approve(randomUUID(),result.revisionId);
  const data=await api.read();expect(data.state.planVersion).toBe(2);expect(data.notices).toHaveLength(data.state.revisions[0].diff.length);validate(data.state);expect(jobs(data.state).filter(m=>m.resourceId?.startsWith('D')).every(m=>m.start>=32)).toBe(true);
  expect(data.state.missions.find(m=>m.id==='B-2')!.start).toBe(groundStart);expect(groundStart).toBeLessThan(32);expect(data.state.missions.find(m=>m.id==='B-2')!.status).toBe('PLANNED');expect(data.state.revisions[0].diff.some(d=>d.missionId==='B-2')).toBe(false);
  await api.deliver(true);expect((await api.read()).notices.every(n=>n.status==='FAILED')).toBe(true);
  await db.outbox.updateMany({data:{availableAt:new Date(0)}});await api.deliver();await api.deliver();
  expect((await api.read()).notices.every(n=>n.status==='DELIVERED'&&n.attempts===2)).toBe(true);
 });
 it('rejects old proposal after safety lock and does not unlock or generate notices',async()=>{
  await prepare();await api.wind(randomUUID());const r=await api.replan(randomUUID()) as {revisionId:string};await api.lock(randomUUID(),'D1');
  await expect(api.approve(randomUUID(),r.revisionId)).rejects.toThrow('오래된');const d=await api.read();expect(d.state.planVersion).toBe(1);expect(d.state.machines[0].safetyLock).toBe(true);expect(d.notices).toHaveLength(0);
  await api.replan(randomUUID());expect((await api.read()).state.revisions.at(-1)!.status).toBe('NO_FEASIBLE_PLAN');
 });
 it('serializes simultaneous different approvals',async()=>{
  await prepare();await api.wind(randomUUID());const r=await api.replan(randomUUID()) as {revisionId:string};
  await Promise.all([api.approve(randomUUID(),r.revisionId),api.approve(randomUUID(),r.revisionId)]);
  expect((await api.read()).state.planVersion).toBe(2);
 });
 it('deduplicates weather input and rejects reused keys with different content',async()=>{
  await prepare();await api.wind(randomUUID());await api.wind(randomUUID());expect((await api.read()).state.events).toHaveLength(1);
  const key=randomUUID();await api.lock(key,'D1');await expect(api.lock(key,'D2')).rejects.toThrow('중복 키');
 });
 it('rejects expired approvals atomically',async()=>{
  await prepare();await api.wind(randomUUID());const r=await api.replan(randomUUID()) as {revisionId:string};const {state:s}=await api.read();s.revisions[0].expiresAt=new Date(0).toISOString();await db.center.update({where:{id:'demo'},data:{state:s}});
  await expect(api.approve(randomUUID(),r.revisionId)).rejects.toThrow('오래된');expect((await api.read()).notices).toHaveLength(0);
 });
 it('hard gates precede scoring and delegated tasks never become farmer tasks',()=>{
  const s=initialState();const f=s.fields[0];f.water=false;expect(recommend(f).find(r=>r.crop==='쌀')!.blocked).toBe(true);
  f.confirmed=false;expect(recommend(f).every(r=>r.provisional)).toBe(true);
  s.fields.forEach(f=>{f.crop='감자';f.mode='완전 위탁형'});expect(annualMissions(s).some(m=>m.owner==='농부')).toBe(false);
  const h=snapshot(s);s.machines[0].safetyLock=true;expect(snapshot(s)).not.toBe(h);
 });
});
