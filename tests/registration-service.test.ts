import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {saveRegistration} from '../lib/registration-service';
import {randomUUID} from 'node:crypto';
import {intakeField} from '../lib/registration-intake';
const input=(pnu:string,version:number)=>{const id=randomUUID();return {requestId:randomUUID(),consultationId:id,consultationVersion:0,fieldVersion:version,testDataOnly:true,consultation:{farmer:{name:'홍검증',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},application:{policy:'OWNER_SERVICE_V1',residence:'가상',cultivationHistory:'가상',supportReason:'가상',exceptionReason:'',review:'pending'},fields:[{id:randomUUID(),pnu,address:'전북특별자치도 장수군 계북면 농소리 616-4',area:'1000',crop:'rice',mode:'joint',tenure:'owned',ownerName:'',ownerPhone:'',evidence:'none',end:'',callAt:'',operator:'',callResult:'pending',scope:'',verified:'pending'}],consent:true,step:3},cultivations:[{cultivation:{id:randomUUID(),pnu,crop:'rice',start:'2031-01-01',end:'2031-12-31',source:'REGISTERED'},context:{region:'계북면'}}]};};
it('isolated transaction joins registration, cultivation and plan; replays once and rolls back all writes',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB only');
 const before=await db.workRecord.count();let id='';
 await expect(db.$transaction(async tx=>{
  const inv=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}}});
  const b=input('5274036023106160004',inv?.version??0);id=b.consultationId;
  // Use a clean inventory only inside this rolled-back isolated transaction.
  await tx.workRecord.deleteMany({where:{workspace:'sandbox',kind:'fields'}});b.fieldVersion=0;
  await tx.workRecord.deleteMany({where:{workspace:'sandbox',kind:'cultivation'}});
  const first=await saveRegistration(tx,b,'test');expect(first.fields).toBe(1);expect(first.drafts).toHaveLength(1);
  expect((await saveRegistration(tx,b,'test')).alreadyApplied).toBe(true);
  expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'cultivation',id:b.cultivations[0].cultivation.id}})).toBe(1);
  await expect(saveRegistration(tx,{...b,consultation:{...b.consultation,farmer:{...b.consultation.farmer,name:'別'}}},'test')).rejects.toThrow('요청 식별자');
  const plan=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'cultivationPlan',id:b.cultivations[0].cultivation.id}}});
  expect(plan).not.toBeNull();expect(first.approvalRequired).toBe(true);
  const duplicate=input(b.consultation.fields[0].pnu,first.fieldVersion);
  await expect(saveRegistration(tx,duplicate,'test')).rejects.toThrow();
  expect(await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'consultation',id:duplicate.consultationId}}})).toBeNull();
  throw Error('ROLLBACK_PROOF');
 },{timeout:20000})).rejects.toThrow('ROLLBACK_PROOF');
 expect(await db.workRecord.count()).toBe(before);
 expect(await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'consultation',id}}})).toBeNull();
});

it('new intake preserves prior fields and accepts full delegation without inventing a crop or plan',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB only');
 const before=await db.workRecord.count();
 await expect(db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:'sandbox',kind:'fields'}});
  const previous=input('5274036023106160004',0);previous.cultivations=[];
  const registered=await saveRegistration(tx,previous,'intake-test');
  const {geometry,selected,...f}=intakeField('5274036023106160005','계북면 검증 필지');
  const full={...input(f.pnu,registered.fieldVersion),consultation:{...previous.consultation,fields:[{...f,area:'2000',crop:'',mode:'delegated'}]},cultivations:[]};
  const result=await saveRegistration(tx,full,'intake-test');
  expect(result).toMatchObject({fields:1,drafts:[],rights:'pending',approvalRequired:true});
  const all=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}}});
  const fields=all!.payload as any[];
  expect(fields).toHaveLength(2);expect(fields[0]).toMatchObject({pnu:previous.consultation.fields[0].pnu,crop:'rice',area:1000});expect(fields[1]).toMatchObject({pnu:f.pnu,crop:'',mode:'full',area:2000,rights:'pending'});
  expect((await saveRegistration(tx,full,'intake-test')).alreadyApplied).toBe(true);
  throw Error('ROLLBACK_INTAKE');
 },{timeout:20000})).rejects.toThrow('ROLLBACK_INTAKE');
 expect(await db.workRecord.count()).toBe(before);
});
