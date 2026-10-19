import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {testSession} from './auth-fixture';
import {emptyCenter} from '../lib/center-registry';
import {emptyLaborOps} from '../lib/labor-operations';
import {withHarvestCarryover} from '../lib/harvest-carryover';
import {withMinimumLaborShifts} from '../lib/labor-shift';
import type {Mission,State} from '../lib/types';
import {todayKst,calculateAnnualReplan,prepareAnnualReplan} from '../lib/annual-replanning';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_TEST'})}));
import {POST} from '../app/api/replanning/route';
const today=todayKst(),tomorrow=new Date(Date.parse(today)+86400000).toISOString().slice(0,10),json=(v:unknown)=>JSON.parse(JSON.stringify(v));
function fixture(){const s=emptyCenter('demo');s.fields=[{id:'p',address:'격리 검증 농지',name:'홍가상',area:1000,crop:'고추',mode:'완전 위탁형',farmerId:'harvest-owner',water:false,access:true,confirmed:true,cluster:'',source:'REGISTERED'}];
 const m:Mission&{operationCode:string}={id:'harvest',fieldId:'p',crop:'고추',label:'최종 수확·선별',operationCode:'harvest',scheduledDate:today,month:Number(today.slice(5,7)),owner:'센터 인력',resourceId:null,status:'PLANNED',start:0,duration:8,staff:1,ordinaryWorkers:1,machineOperators:0,transport:0,priority:1,batchKey:'h',deadline:32,planningWindow:{from:today,to:today,duration:8,basis:'DEMO_OPERATION_WINDOW',windLimitMs:10,rainSensitive:true}};
 s.staffCount=1;s.crewCapacity={workers:1,operators:0};s.missions=[{...m,id:'completed',status:'COMPLETED'},m];return {s,m};}
it('carries only a missed selected harvest and reserves four hours without rewriting history',()=>{
 const {s,m}=fixture(),before=json(s);const moved=withMinimumLaborShifts(withHarvestCarryover(s,{ids:[m.id]},today),[m.id]);
 expect(moved.missions[1]).toMatchObject({duration:16,laborWorkMinutes:120,harvestCarryover:{originalTo:today,date:tomorrow},planningWindow:{from:tomorrow,to:tomorrow,duration:16}});expect(s).toEqual(before);expect(moved.missions[0]).toEqual(s.missions[0]);
 m.operationCode='plant';expect(withHarvestCarryover(s,{ids:[m.id]},today).missions[1].harvestCarryover).toBeUndefined();
 m.operationCode='harvest';expect(withHarvestCarryover(s,{ids:[m.id],preferred:'2035-03-01'},today).missions[1].harvestCarryover).toBeUndefined();
});
it('repairs next-day conflicts without pulling unrelated later incomplete work into harvest recovery',async()=>{
 const {s,m}=fixture();s.staffCount=2;s.crewCapacity={workers:2,operators:0};
 const later=new Date(Date.parse(tomorrow)+21*86400000).toISOString().slice(0,10);
 const a={...m,id:'neighbor-a',fieldId:'a',scheduledDate:tomorrow,planningWindow:{...m.planningWindow!,from:tomorrow,to:tomorrow}};
 const b={...a,id:'neighbor-b',fieldId:'b'};
 const c={...a,id:'neighbor-c',fieldId:'c'};
 // Existing three-way overlap must be repaired, but later cleanup has no
 // valid predecessor. It does not prevent harvesting a different field now.
 const cleanup={...a,id:'cleanup',operationCode:'cleanup',scheduledDate:later,predecessorMissionIds:[a.id],planningWindow:{...a.planningWindow,from:later,to:later}};
 const other={...cleanup,id:'other-cleanup',fieldId:'other',predecessorMissionIds:['missed-plant']};
 const missed={...m,id:'missed-plant',fieldId:'other',operationCode:'plant',scheduledDate:'2020-05-01'};
 s.missions.push(a,b,c,cleanup,other,missed);
 const input={ids:[m.id],deferAfter:today,scope:'EXPAND' as const},w={status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED'} as any;
 const prepared=prepareAnnualReplan(s,input,w,today);
 expect(prepared.contract.tasks.map(t=>t.id)).not.toContain(other.id);
 expect(prepared.contract.tasks.find(t=>t.id===cleanup.id)?.locked).toBe(true);
 const result=await calculateAnnualReplan(s,input,w,today);
 expect(result.status).toBe('FEASIBLE');expect(result.diff.find(d=>d.id===m.id)?.date).toBe(tomorrow);
 expect(result.diff.every(d=>d.date===tomorrow)).toBe(true);
});
it.each(['ordinary','reserve','no-reserve'] as const)('automatic next-day harvest uses %s and persists the same validated demand',async mode=>{
 const f=await laborCapacityFixture(),session=await testSession('CENTER_STAFF');
 try{const {s,m}=fixture();if(mode!=='ordinary'){s.staffCount=0;s.crewCapacity={operators:0,workers:0};}
 const roster={...emptyLaborOps(),people:mode==='reserve'?[{...f.worker,employment:'CENTER_RESERVE' as const,standbyDates:[tomorrow]}]:[]};
 await db.workRecord.update({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}},data:{payload:json(roster)}});
 await db.center.update({where:{id:'demo'},data:{state:json(s)}});
 const body={action:'automatic',requestId:randomUUID(),ids:[m.id],reason:'기타 변경',deferAfter:today};
 const call=async()=>{const r=await POST(new NextRequest('http://localhost/api/replanning',{method:'POST',headers:session.headers,body:JSON.stringify(body)}));const d=await r.json();expect(r.status,JSON.stringify(d)).toBe(200);return d;};
 const result=await call();expect(result.status,JSON.stringify(result)).toBe(mode==='no-reserve'?'RESOURCE_REQUIRED':'APPLIED');
 const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;expect(saved.missions[0]).toEqual(s.missions[0]);
 if(mode!=='no-reserve'){expect(saved.missions[1]).toMatchObject({scheduledDate:tomorrow,duration:16,harvestCarryover:{originalTo:today,date:tomorrow}});expect(await call()).toEqual(result);
  const demand=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborDemand',id:m.id}}});expect(demand.payload).toMatchObject({date:tomorrow,durationMinutes:240,people:1});}
 if(mode==='reserve'){const ops=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}})).payload as any;expect(ops.jobs.find((j:any)=>j.status==='OPEN')).toMatchObject({date:tomorrow,durationMinutes:240,assigned:[f.worker.id],responses:{[f.worker.id]:'STANDBY'}});}
 }finally{await session.cleanup();await f.cleanup();}
},60000);
