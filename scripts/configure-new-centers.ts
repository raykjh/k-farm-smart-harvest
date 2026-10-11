import {db} from '../lib/db';
import {fetchCenterGeography,installCenterDemo} from '../lib/center-demo-fixture';
// Run with node --env-file=.env.local --import tsx. Default is read-only preview.
try{
 const ids=['janggye','cheoncheon','gyenam'];
 const geography=await Promise.all(ids.map(fetchCenterGeography));
 if(process.argv.includes('--apply')){
  if(!process.env.DATABASE_URL?.endsWith('/kfarm'))throw Error('명시된 로컬 운영 DB에만 적용');
  const result=await db.$transaction(async tx=>{const rows=[];for(const [i,id] of ids.entries())rows.push(await installCenterDemo(tx,id,geography[i]));return rows},{timeout:60000});console.log(JSON.stringify({applied:true,result}));
 }else console.log(JSON.stringify({applied:false,regions:geography.map(({geometry,...g})=>g),perCenter:{equipment:16,crew:6,transport:2,cropYears:[2026,2027]},dataOrigin:'DEMO',externalActions:false}));
}catch(e){console.error(e instanceof Error?e.message:'설정 실패');process.exitCode=1}finally{await db.$disconnect()}
