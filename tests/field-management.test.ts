import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {fieldManagementFixture} from './field-management-fixture';
import {testSession,testPrincipal} from './auth-fixture';
import {catalogContext} from './catalog-fixtures';
import {GET as readOwner} from '../app/api/consultations/route';
import {GET as readFields} from '../app/api/fields/route';
import {POST as createCycle} from '../app/api/cultivations/route';
import {GET as preview,POST as approve} from '../app/api/annual-dispatch/route';
import {POST as change} from '../app/api/cultivation-change/route';
import {permitted} from '../lib/auth-policy';
import type {State} from '../lib/types';

it('leaves an unselected parcel pending, then saves a staff-selected crop, schedules it once and allows normal change review',async()=>{
 const fixture=await fieldManagementFixture(),staff=await testSession('CENTER_STAFF'),other=await testSession('CENTER_STAFF','janggye');
 const request=(path:string,body?:unknown,headers=staff.headers)=>new NextRequest('http://127.0.0.1:3100/api/'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 try{
  const calls=await db.aiCall.count();
  expect((await (await readFields(request('fields'))).json()).payload[0].crop).toBe('');
  expect((await (await readOwner(request('consultations?id='+fixture.ownerId))).json()).payload.farmer.name).toBe('홍가상');
  expect((await readOwner(request('consultations?id='+fixture.ownerId,undefined,other.headers))).status).toBe(404);
  expect(await db.workRecord.count({where:{kind:'cultivation'}})).toBe(0);
  const id=randomUUID(),data={cultivation:{id,pnu:fixture.field.pnu,crop:'soybean',start:'2034-01-01',end:'2034-12-31',source:'REGISTERED'},context:catalogContext()};
  const created=await createCycle(request('cultivations',data));expect(created.status,await created.clone().text()).toBe(200);
  expect((await (await readFields(request('fields'))).json()).payload[0].crop).toBe('');
  const calculated=await preview(request('annual-dispatch?cultivationId='+id)),p=await calculated.json();expect(calculated.status,JSON.stringify(p)).toBe(200);
  const approved=await approve(request('annual-dispatch',{cultivationId:id,token:p.token,demoAcknowledged:true}));expect(approved.status,await approved.clone().text()).toBe(200);
  const before=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  expect(before.fields[0].crop).toBe('콩');expect(before.missions.length).toBeGreaterThan(3);
  expect((await (await readFields(request('fields'))).json()).payload[0].crop).toBe('soybean');
  const repeated=await approve(request('annual-dispatch',{cultivationId:id,token:p.token,demoAcknowledged:true}));expect((await repeated.json()).alreadyApplied).toBe(true);
  const inspected=await change(request('cultivation-change',{id,crop:'sesame',area:1000,context:catalogContext(),action:'preview'})),c=await inspected.json();
  expect(inspected.status,JSON.stringify(c)).toBe(200);expect(c.approvedPlan).toBe(true);expect(c.impact.removed.length).toBe(before.missions.length);
  expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(before);
  expect(c.blockers,JSON.stringify(c)).toHaveLength(0);
  const changed=await change(request('cultivation-change',{id,crop:'sesame',area:1000,context:catalogContext(),action:'approve',token:c.token,review:{cost:'위탁 범위 내 검토',consent:'소유주 위임 범위 내 작물 변경'}}));
  expect(changed.status,await changed.clone().text()).toBe(200);
  expect((await (await readFields(request('fields'))).json()).payload[0].crop).toBe('sesame');
  expect(await db.workRecord.count({where:{kind:'cultivation'}})).toBe(1);
  expect((await createCycle(request('cultivations',data,other.headers))).status).toBe(409);
  expect(await db.aiCall.count()).toBe(calls);
 }finally{await staff.cleanup();await other.cleanup();await fixture.cleanup()}
},60000);

it('permits center crop work without granting account, report-finalization or global authority',()=>{
 const staff={...testPrincipal,role:'CENTER_STAFF' as const};
 expect(permitted(staff,'cultivations','POST',{})).toBe(true);
 expect(permitted(staff,'annual-dispatch','POST',{})).toBe(true);
 expect(permitted(staff,'execution-records','POST',{kind:'snapshot'})).toBe(false);
 expect(permitted(staff,'accounts','POST',{})).toBe(false);
 expect(permitted({...staff,centerId:null},'cultivations','POST',{})).toBe(false);
 expect(permitted({...staff,role:'SUPER_ADMIN',centerId:null},'cultivations','POST',{})).toBe(false);
});
