import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import type {Prisma} from '@prisma/client';
import {GET} from '../app/api/equipment-information/route';
import {db} from '../lib/db';
import {emptyCenter} from '../lib/center-registry';
import {permitted} from '../lib/auth-policy';
import {testSession,testPrincipal} from './auth-fixture';

it('exposes only the signed-in center inventory, ignoring forged center parameters; GET never edits the center',async()=>{
 const staff=await testSession('CENTER_STAFF');const prior=await db.center.findUnique({where:{id:'demo'}});
 try{
  const state=emptyCenter('demo');state.machines=[{id:'JB23DR01',name:'Drone',type:'드론',ownerCenterId:'demo',status:'AVAILABLE',safetyLock:false,capacityHaHour:1},{id:'JSJGDR01',name:'Borrowed',type:'드론',ownerCenterId:'janggye',status:'AVAILABLE',safetyLock:false,capacityHaHour:1}];
  await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:state as unknown as Prisma.InputJsonValue},update:{state:state as unknown as Prisma.InputJsonValue}});
  const before=await db.center.findUnique({where:{id:'demo'}});
  const response=await GET(new NextRequest('http://127.0.0.1:3100/api/equipment-information?centerId=janggye',{headers:staff.headers}));
  expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
  const data=await response.json();expect(data.centerId).toBe('demo');expect(data.machines.map((m:{id:string})=>m.id)).toEqual(['JB23DR01']);
  expect(await db.center.findUnique({where:{id:'demo'}})).toEqual(before);
 }finally{if(prior)await db.center.update({where:{id:'demo'},data:{state:prior.state as Prisma.InputJsonValue,version:prior.version,updatedAt:prior.updatedAt}});else await db.center.delete({where:{id:'demo'}});await staff.cleanup()}
});
it('allows global reference reading without disclosing center inventory; denies anonymous and unknown centers',async()=>{
 const global=await testSession('SUPER_ADMIN',null),unknown=await testSession('CENTER_STAFF','unknown');
 try{
  const url='http://127.0.0.1:3100/api/equipment-information';
  expect(await (await GET(new NextRequest(url,{headers:global.headers}))).json()).toEqual({centerId:null,machines:[]});
  expect((await GET(new NextRequest(url))).status).toBe(401);
  expect((await GET(new NextRequest(url,{headers:unknown.headers}))).status).toBe(403);
  for(const role of ['SUPER_ADMIN','CENTER_ADMIN','CENTER_STAFF'] as const)expect(permitted({...testPrincipal,role},'equipment-information','POST',{})).toBe(false);
 }finally{await global.cleanup();await unknown.cleanup()}
});
