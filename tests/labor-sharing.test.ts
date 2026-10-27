import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {recordSpace} from '../lib/workspace';
import {emptyCenter} from '../lib/center-registry';
import {reconcileLaborShares,externalLaborBusy,eligibleShare,type LaborShare} from '../lib/labor-sharing';
import {emptyLaborOps,canAssign,type LaborJob,type Worker} from '../lib/labor-operations';
import {permitted} from '../lib/auth-policy';
import {testPrincipal} from './auth-fixture';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const worker=(id:string):Worker=>({id,name:'홍검증',birth:'1960-01-01',phone:'000',address:'test',registeredFarmer:false,usesApp:false,active:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['harvest']});
const job=(id:string):LaborJob=>({id,missionId:id,task:'수확',address:'test',date:'2032-09-01',startMinute:540,durationMinutes:60,count:1,workCode:'harvest',sourceHash:'hash-'+id,pay:'test only',status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[]});
const offer=(id:string,workerId:string,jobId='job'):LaborShare=>({id,ownerCenterId:'demo',borrowerCenterId:'janggye',workerId,workerName:'홍검증',jobId,sourceHash:'hash-'+jobId,date:'2032-09-01',startMinute:540,durationMinutes:60,travelMinutes:30,distanceKm:5,response:'PHONE',consent:true,status:'WAITLIST',reason:'test',actor:'tester',createdAt:'2026-10-03T00:00:00Z'});
it('requires direct adjacency, available travel time and matching consented job version',()=>{
 const w=worker(randomUUID()),o=offer(randomUUID(),w.id),j=job('job'),ops={...emptyLaborOps(),people:[w]};
 expect(eligibleShare(o,ops,j,['janggye'])).toBe(true);expect(eligibleShare(o,ops,j,[])).toBe(false);
 expect(eligibleShare({...o,sourceHash:'old'},ops,j,['janggye'])).toBe(false);
 w.startMinute=540;expect(eligibleShare(o,ops,j,['janggye'])).toBe(true);
 expect(eligibleShare({...o,travelMinutes:600},ops,j,['janggye'])).toBe(false);
});
it('ranks confirmed neighbors after local attendees; prevents cross-center overlap; schedule changes invalidate attendance and notify both centers',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB required');
 await expect(db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{kind:{in:['laborShare','laborShareNotice','laborOperations','centerGeography']}}});
  const a=randomUUID(),b=randomUUID(),owner={...emptyLaborOps(),people:[worker(a),worker(b)]},borrower={...emptyLaborOps(),jobs:[job('job'),job('other')]};
  for(const [id,ops,x] of [['demo',owner,0],['janggye',borrower,1]] as const){
   const s=emptyCenter(id);s.missions=ops.jobs.map(j=>({id:j.id,fieldId:'p',label:j.task,crop:'쌀',scheduledDate:j.date,month:9,owner:'센터 인력',status:'PLANNED',resourceId:null,start:4,duration:4,deadline:32,priority:1,batchKey:j.id,staff:1,transport:0}));
   await tx.center.upsert({where:{id},create:{id,state:json(s)},update:{state:json(s)}});
   await tx.workRecord.create({data:{workspace:recordSpace(id),kind:'laborOperations',id:'current',payload:json(ops)}});
   await tx.workRecord.create({data:{workspace:recordSpace(id),kind:'centerGeography',id:'current',payload:{geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}}}});
  }
  const first=offer(randomUUID(),a),second={...offer(randomUUID(),b),distanceKm:1},other=offer(randomUUID(),b,'other');
  for(const o of [first,second,other])await tx.workRecord.create({data:{workspace:'shared',kind:'laborShare',id:o.id,payload:json(o)}});
  await reconcileLaborShares(tx);
  const read=async(id:string)=>(await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'laborShare',id}}})).payload as unknown as LaborShare;
  expect((await read(second.id)).status).toBe('ASSIGNED');expect((await read(first.id)).status).toBe('WAITLIST');expect((await read(other.id)).status).toBe('WAITLIST');
  const busy=await externalLaborBusy(tx,'demo'),ownJob={...job('local'),invited:[b],responses:{[b]:'PHONE' as const}};
  expect(canAssign({...owner,externalBusy:busy},ownJob,owner.people[1])).toBe(false);
  borrower.jobs[0].assigned=['local-attendee'];
  await tx.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace('janggye'),kind:'laborOperations',id:'current'}},data:{payload:json(borrower)}});
  await reconcileLaborShares(tx);expect((await read(second.id)).status).toBe('WAITLIST');expect((await read(other.id)).status).toBe('ASSIGNED');
  borrower.jobs[1].sourceHash='new-plan';borrower.jobs[1].date='2032-09-02';
  await tx.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace('janggye'),kind:'laborOperations',id:'current'}},data:{payload:json(borrower)}});
  await reconcileLaborShares(tx);expect((await read(other.id)).status).toBe('CANCELLED');
  for(const id of ['demo','janggye'])expect(await tx.workRecord.count({where:{workspace:recordSpace(id),kind:'laborShareNotice'}})).toBeGreaterThan(0);
  throw Error('ROLLBACK_LABOR_SHARING');
 },{timeout:30000})).rejects.toThrow('ROLLBACK_LABOR_SHARING');
});
it('allows both center roles to manage people and equipment while retaining center boundaries',()=>{
 for(const p of ['labor-sharing','equipment-missions']){expect(permitted(testPrincipal,p,'POST',{})).toBe(true);expect(permitted({...testPrincipal,role:'CENTER_STAFF'},p,'POST',{})).toBe(true);expect(permitted({...testPrincipal,role:'CENTER_STAFF',centerId:'unknown'},p,'POST',{})).toBe(false);expect(permitted({...testPrincipal,role:'SUPER_ADMIN',centerId:null},p,'GET',{})).toBe(false);}
});
