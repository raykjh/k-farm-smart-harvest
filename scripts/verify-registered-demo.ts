import {db} from '../lib/db';
import {removeRegisteredDemo} from '../lib/registered-demo-storage';
import {DEMO_BATCH} from '../lib/registered-demo';
let rolledBack=false;
try{
 await db.$transaction(async tx=>{
  await removeRegisteredDemo(tx);
  const rows=await tx.$queryRaw<{n:bigint}[]>`SELECT count(*) AS n FROM "WorkRecord" WHERE kind='demoManifest' AND id=${DEMO_BATCH}`;
  if(Number(rows[0].n)!==0)throw Error('Removal incomplete');
  throw Error('EXPECTED_ROLLBACK');
 });
}catch(e){if(e instanceof Error&&e.message==='EXPECTED_ROLLBACK')rolledBack=true;else throw e}
const rows=await db.$queryRaw<{n:bigint}[]>`SELECT count(*) AS n FROM "WorkRecord" WHERE kind='consultation' AND id LIKE '20260000-%'`;
if(!rolledBack||Number(rows[0].n)!==30)throw Error('Preservation failed');
console.log('PASS: transactional removal rollback; 30 registrations preserved');
await db.$disconnect();
