import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {POST} from '../app/api/production-coordination/route';
import {coordinationPolicyKey} from '../lib/production-coordination-store';
import {emptyCoordinationPolicy,type CoordinationPolicy} from '../lib/production-coordination';

const evidence={sourceUrl:'https://example.com/isolated-policy-fixture',method:'Synthetic policy route fixture, not operational evidence',checkedOn:'2026-10-01',validUntil:'2027-12-31'};
const extendedKeys=['economicReferences','nationalReferences','equipmentCostRates','operatorCostRates'] as const;
const triple=(value:number)=>({low:value,base:value,high:value});
function policy():CoordinationPolicy{
 return {...emptyCoordinationPolicy(),
  economicReferences:[{...evidence,version:'synthetic-economic-v1',asOf:'2026-09-30',sourceDataKind:'SYNTHETIC_FIXTURE',origin:'DEMO',crop:'potato',commodity:'TEST_POTATO',unit:'kg',harvestPeriod:{from:'2027-01-01',to:'2027-12-31'},yieldKgPer1000m2:triple(1000),marketableFraction:triple(1),price:{...triple(1000),unit:'KRW_PER_KG',stage:'FARM_GATE',basis:'HISTORICAL_SCENARIO'},cost:{...evidence,version:'synthetic-cost-v1',mode:'STATISTICAL_TOTAL',includesLabor:true,includesEquipment:true,totalWonPer1000m2:triple(100000)}}],
  nationalReferences:[{crop:'potato',sourceUrl:evidence.sourceUrl,asOf:'2026-09-30',checkedOn:evidence.checkedOn,validUntil:evidence.validUntil,observationPeriod:{from:'2026-01-01',to:'2026-09-30'},harvestPeriod:null,commodity:'TEST_POTATO',unit:'KRW/kg',version:'synthetic-observed-v1',origin:'OBSERVED',geography:'KR',reuse:'ALLOWED',priceStage:'WHOLESALE',facts:{metric:'PRICE',value:1000}}],
  equipmentCostRates:[{centerId:'demo',machineId:'JB23TR01',origin:'DEMO',wonPerHour:30000,unit:'KRW_PER_HOUR',version:'synthetic-rate-v1',sourceUrl:evidence.sourceUrl,checkedOn:evidence.checkedOn,validUntil:evidence.validUntil}],
  operatorCostRates:[{...evidence,centerId:'demo',origin:'DEMO',year:2027,hourlyWon:15000,policyVersion:1,version:'synthetic-operator-v1'}],
 };
}
type Session=Awaited<ReturnType<typeof testSession>>;
const request=(session:Session,version:number,payload:unknown)=>POST(new NextRequest('http://127.0.0.1:3100/api/production-coordination',{method:'POST',headers:session.headers,body:JSON.stringify({version,policy:payload})}));
const read=()=>db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:coordinationPolicyKey}});

/** This test owns only its policy/auth/audit fixtures and restores prior rows.
 * The private port check prevents accidentally using any older kfarm_test DB. */
async function isolated(run:(context:{center:Session;global:Session;version:number})=>Promise<void>){
 const target=new URL(process.env.DATABASE_URL??'');
 if(target.hostname!=='127.0.0.1'||target.port!=='55433'||target.pathname!=='/kfarm_test')throw Error('Dedicated economic verification DB on port 55433 required');
 if(process.env.AI_MODE!=='demo')throw Error('Model-free verification required');
 const original=await db.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}}),auditIds=(await db.audit.findMany({select:{id:true}})).map(a=>a.id);
 const center=await testSession('CENTER_ADMIN','demo'),global=await testSession('SUPER_ADMIN',null);
 try{await run({center,global,version:original?.version??0});}
 finally{
  if(original)await db.workRecord.update({where:{workspace_kind_id:coordinationPolicyKey},data:{payload:original.payload as any,version:original.version,updatedAt:original.updatedAt}});
  else await db.workRecord.deleteMany({where:coordinationPolicyKey});
  await db.audit.deleteMany({where:{id:{notIn:auditIds}}});
  await center.cleanup();await global.cleanup();
 }
 expect(await db.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}})).toEqual(original);
}

it('requires global authority for economic, national, operator and equipment-cost creation, rollback and deletion',async()=>isolated(async({center,global,version})=>{
 const proposed=policy();
 expect((await request(center,version,proposed)).status).toBe(409);
 expect((await request(global,version,proposed)).status).toBe(200);
 const saved=await read();expect(saved.payload).toEqual(proposed);expect(saved.version).toBe(version+1);
 for(const key of extendedKeys){
  const removed=structuredClone(proposed);removed[key]=[];
  expect((await request(center,saved.version,removed)).status).toBe(409);
  const reverted=structuredClone(proposed);reverted[key]![0].version='rollback-before-v1';
  expect((await request(center,saved.version,reverted)).status).toBe(409);
  expect(await read()).toEqual(saved);
 }
 expect((await request(global,version,proposed)).status).toBe(409);
 expect(await read()).toEqual(saved);
}));

it('rejects future review dates and incompatible units in every new reference family',async()=>isolated(async({global,version})=>{
 const proposed=policy();expect((await request(global,version,proposed)).status).toBe(200);const saved=await read();
 for(const key of extendedKeys){
  const future=structuredClone(proposed);future[key]![0].checkedOn='2099-01-01';future[key]![0].validUntil='2099-12-31';
  expect((await request(global,saved.version,future)).status).toBe(409);
  const wrong=structuredClone(proposed) as any;wrong[key][0].unit=key==='nationalReferences'?'tonne':key==='equipmentCostRates'?'KRW_PER_DAY':'tonne';
  expect((await request(global,saved.version,wrong)).status).toBe(409);
  expect(await read()).toEqual(saved);
 }
 // A nested cost source is economic evidence too; a current price source does
 // not make a future-dated cost review valid.
 const futureCost=structuredClone(proposed),cost=futureCost.economicReferences![0].cost;
 if(cost.mode!=='STATISTICAL_TOTAL')throw Error('fixture');cost.checkedOn='2099-01-01';cost.validUntil='2099-12-31';
 expect((await request(global,saved.version,futureCost)).status).toBe(409);
 expect(await read()).toEqual(saved);
}));

it('preserves new references omitted by a legacy global client and clears them only with explicit arrays',async()=>isolated(async({global,version})=>{
 const proposed=policy();expect((await request(global,version,proposed)).status).toBe(200);
 const first=await read(),legacy=emptyCoordinationPolicy();
 expect((await request(global,first.version,legacy)).status).toBe(200);
 const kept=await read();for(const key of extendedKeys)expect((kept.payload as any)[key]).toEqual(proposed[key]);
 const explicitlyCleared={...legacy,economicReferences:[],nationalReferences:[],equipmentCostRates:[],operatorCostRates:[]};
 expect((await request(global,kept.version,explicitlyCleared)).status).toBe(200);
 const cleared=await read();for(const key of extendedKeys)expect((cleared.payload as any)[key]).toEqual([]);
}));

it('lets a legacy center client update its own specialty while preserving omitted global references',async()=>isolated(async({center,global,version})=>{
 const proposed=policy();expect((await request(global,version,proposed)).status).toBe(200);const saved=await read();
 const legacy=emptyCoordinationPolicy();legacy.specialties=[{...evidence,centerId:'demo',crop:'potato',status:'DEVELOPMENT_CANDIDATE',bonus:1}];
 expect((await request(center,saved.version,legacy)).status).toBe(200);
 const kept=await read();expect((kept.payload as any).specialties).toEqual(legacy.specialties);
 for(const key of extendedKeys)expect((kept.payload as any)[key]).toEqual(proposed[key]);
 const forbidden=structuredClone(legacy);forbidden.specialties.push({...legacy.specialties[0],centerId:'janggye'});
 expect((await request(center,kept.version,forbidden)).status).toBe(409);
 expect(await read()).toEqual(kept);
}));
