import {PrismaClient,Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {registeredDemo} from '../lib/registered-demo';
import {readProviderArtifact} from '../lib/provider-artifacts';
import {fetchCenterGeography} from '../lib/center-demo-fixture';
import {repairLegacyResourceLinks,RESOURCE_LINK_REPAIR} from '../lib/legacy-resource-links';
import {geographicNeighbors} from '../lib/center-adjacency';
import {lockCenterPool} from '../lib/center-resources';
import {recordSpace} from '../lib/workspace';
import type {State} from '../lib/types';

// Default: preview. Explicit --apply changes only known synthetic metadata and
// missing official center geometry. No scheduling, model call, loan or notice.
const url=new URL(process.env.DATABASE_URL??'');
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/kfarm')throw Error('Explicit local operating database required');
const db=new PrismaClient(),apply=process.argv.includes('--apply');
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const asOf=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
try{
 const parcels=readProviderArtifact('registeredParcels');if(!parcels)throw Error('Existing parcel baseline required; not re-seeding');
 const originals=new Map(registeredDemo(parcels as Parameters<typeof registeredDemo>[0]).state.missions.map(m=>[m.id,m]));
 const centers=await db.center.findMany({orderBy:{id:'asc'}});
 const plans=centers.map(c=>({before:c,...repairLegacyResourceLinks(c.state as unknown as State,c.id,asOf,originals)}));
 const geography=await db.workRecord.findMany({where:{kind:'centerGeography',id:'current'}});
 const missing=centers.filter(c=>['demo','janggye','cheoncheon','gyenam'].includes(c.id)&&!geography.some(g=>g.workspace===recordSpace(c.id)));
 const maps=await Promise.all(missing.map(async c=>({id:c.id,geography:await fetchCenterGeography(c.id)})));
 const summary={asOf,changes:plans.map(p=>({center:p.before.id,machines:p.machines,windows:p.windows.length})),geography:maps.map(m=>({center:m.id,name:m.geography.name,code:m.geography.code,source:m.geography.sourceUrl}))};
 if(!apply)console.log(JSON.stringify({applied:false,...summary}));
 else{
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,''),directory=resolve('.data/backups/resource-links-'+stamp);
  const changed=plans.filter(p=>p.machines.length||p.windows.length);
  if(!changed.length&&!maps.length){console.log(JSON.stringify({applied:false,unchanged:true,...summary}));}
  else{
   // Consistent full application backup. Contains private rows; never publish.
   const snapshot=await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return {centers:await tx.center.findMany({orderBy:{id:'asc'}}),records:await tx.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),outbox:await tx.outbox.findMany({orderBy:{id:'asc'}}),receipts:await tx.receipt.findMany({orderBy:{id:'asc'}}),audit:await tx.audit.findMany({orderBy:{id:'asc'}}),budgets:await tx.aiBudget.findMany({orderBy:{id:'asc'}}),calls:await tx.aiCall.findMany({orderBy:{id:'asc'}})};
   },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
   if(hash(snapshot.centers)!==hash(centers))throw Error('Center records changed; rerun the preview');
   mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'application.json'),JSON.stringify({format:'KFARM_APPLICATION_SNAPSHOT_V1',sha256:hash(snapshot),snapshot}),{flag:'wx',mode:0o600});
   const neighbors=await db.$transaction(async tx=>{
    await lockCenterPool(tx);
    if(hash(await tx.center.findMany({orderBy:{id:'asc'}}))!==hash(centers))throw Error('Concurrent center change; nothing applied');
    for(const m of maps){const key={workspace:recordSpace(m.id),kind:'centerGeography',id:'current'};if(await tx.workRecord.findUnique({where:{workspace_kind_id:key}}))throw Error('Geography changed; nothing applied');await tx.workRecord.create({data:{...key,payload:JSON.parse(JSON.stringify(m.geography))}});}
    for(const p of changed){
     p.state.planVersion++;
     await tx.$executeRaw`UPDATE "Center" SET state=${JSON.stringify(p.state)}::jsonb,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=${p.before.id}`;
     await tx.audit.create({data:{centerId:p.before.id,action:RESOURCE_LINK_REPAIR,detail:{origin:'DEMO_INPUT',machineIds:p.machines,windowIds:p.windows,asOf,preservedTaskDates:true,preservedExecutionHistory:true}}});
    }
    await tx.workRecord.create({data:{workspace:'shared',kind:'resourceLinkRepair',id:stamp,payload:JSON.parse(JSON.stringify({version:RESOURCE_LINK_REPAIR,summary,beforeCenters:changed.map(p=>p.before),createdGeography:maps.map(m=>recordSpace(m.id)),backup:directory}))}});
    return Promise.all(centers.map(async c=>({id:c.id,neighbors:await geographicNeighbors(tx,c.id)})));
   },{timeout:30000});
   console.log(JSON.stringify({applied:true,...summary,neighbors,backup:directory,paidAiCalls:0,externalDispatch:false}));
  }
 }
}catch(e){console.error(e instanceof Error?e.message:'Resource connection failed');process.exitCode=1}finally{await db.$disconnect()}
