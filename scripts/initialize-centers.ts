import {db} from '../lib/db';
import {centerRegistry,emptyCenter} from '../lib/center-registry';
// Additive only. Existing state, accounts, resources and histories are never edited.
try{
 const existing=await db.center.findMany({select:{id:true}});
 const missing=centerRegistry.filter(c=>!existing.some(e=>e.id===c.id));
 if(process.argv.includes('--apply'))await db.$transaction(async tx=>{for(const c of missing)await tx.center.create({data:{id:c.id,state:JSON.parse(JSON.stringify(emptyCenter(c.id)))}})});
 console.log(JSON.stringify({applied:process.argv.includes('--apply'),missing:missing.map(c=>({id:c.id,name:c.name})),resourcesCreated:0,accountsCreated:0}));
}finally{await db.$disconnect()}
