import {db} from '../lib/db';
import {createSession,AUTH_COOKIE,digest,type User} from '../lib/auth';
import {registrationCommand} from '../lib/registration-service';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const base='http://127.0.0.1:3100',dir=resolve('.data/sequential-intake-20261016'),url=new URL(process.env.DATABASE_URL??'');
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/kfarm'||!process.argv.includes('--apply-demo-inputs'))throw Error('Explicit local demo command required');
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
let token='';
async function api(path:string,body?:unknown){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie:`${AUTH_COOKIE}=${token}`,origin:base,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});const d=await r.json();if(!r.ok)throw Error(d.error??r.status);return d}
try{
 const u=(await db.workRecord.findMany({where:{workspace:'auth',kind:'user'}})).map(r=>r.payload as User).find(u=>u.name==='순차 입력 검증 담당자'&&u.centerId==='demo'&&u.role==='CENTER_ADMIN');if(!u)throw Error('Active validation administrator required');
 token=await createSession(u.id);
 const before=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
 if(before.fields.length!==3)throw Error('Expected three earlier accepted registrations');
 if(!before.machines.some((m:any)=>m.id==='JB23TR03'))await api('/api/equipment',{version:before.planVersion,autoCode:true,equipment:{id:'JB23TR03',name:'트랙터',kind:'TR',compatibleCrops:['garlic','onion'],capacityHaHour:0.4,status:'AVAILABLE',manufacturer:'',model:'',product:'',purchasedOn:'',servicePhone:'',notes:'DEMO · 마늘·양파용 경운 작업기'}});
 const inputs=JSON.parse(readFileSync(resolve(dir,'inputs.json'),'utf8')),parcels=JSON.parse(readFileSync(resolve('lib/demo-parcels.json'),'utf8'));
 const p=parcels.filter((p:any)=>p.land==='전'&&!inputs.registrations.some((r:any)=>r.consultation.fields[0].pnu===p.pnu)).sort((a:any,b:any)=>a.area-b.area)[0];
 const inventory=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}}});
 const r=structuredClone(inputs.registrations[1]);r.requestId=randomUUID();r.consultationId=randomUUID();r.fieldVersion=inventory.version;
 r.consultation.farmer={...r.consultation.farmer,name:'홍정희',phone:'010-0000-9004'};
 r.consultation.fields=[{...r.consultation.fields[0],id:randomUUID(),pnu:p.pnu,address:p.address,area:String(p.area),ownerName:'홍정희',ownerPhone:'010-0000-9004'}];
 const registration=registrationCommand.parse(r),key={workspace:'sandbox',kind:'demoInputBatch',id:inputs.batchId},row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),batch=row.payload as any;
 batch.registrations.push({requestId:r.requestId,inputHash:hash(registration)});await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:batch,version:{increment:1}}});
 inputs.registrations.push(registration);writeFileSync(resolve(dir,'inputs.json'),JSON.stringify(inputs,null,2),{mode:0o600});
 await api('/api/registrations',registration);console.log(JSON.stringify({step:'AUTUMN_REGISTERED',index:4}));
 const deadline=Date.now()+360000;let view:any;
 while(Date.now()<deadline){view=(await api('/api/continuous-production')).view;if(view?.aiReviewError)throw Error(view.aiReviewError.message);if(view?.integratedPlan?.source==='NEBIUS'&&view.integratedPlan.choices?.some((c:any)=>c.pnu===p.pnu))break;await new Promise(r=>setTimeout(r,2000));}
 if(!view?.integratedPlan?.choices.some((c:any)=>c.pnu===p.pnu))throw Error('Automatic autumn plan timeout');
 const item=view.items.find((i:any)=>i.pnu===p.pnu),result=await api('/api/continuous-production',{action:'approve',requestId:randomUUID(),fingerprint:view.fingerprint,pnus:[p.pnu],provisionalAcknowledged:true});
 const after=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
 for(const m of before.missions)if(hash(after.missions.find((x:any)=>x.id===m.id))!==hash(m))throw Error('Earlier work changed');
 const proof={index:4,crop:item.proposal.cultivation.crop,pnu:p.pnu,aiRequestId:view.integratedPlan.requestId,assigned:result.assigned,fields:after.fields.length,missions:after.missions.length,priorPreserved:true,notificationCount:result.notifications};
 writeFileSync(resolve(dir,'autumn-evidence.json'),JSON.stringify(proof,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(proof));
}finally{if(token)await db.workRecord.deleteMany({where:{workspace:'auth',kind:'session',id:digest(token)}});await db.$disconnect()}
