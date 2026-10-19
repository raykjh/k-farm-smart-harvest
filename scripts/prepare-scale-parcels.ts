import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fetchFourCenterCadastre,cadastreSnapshotSchema} from '../lib/four-center-cadastre';
import {fetchCenterGeography} from '../lib/center-demo-fixture';
import {centerRegistry} from '../lib/center-registry';

// Private provider artifact only. No ownership inference, crop assignment or DB seed.
const folder=resolve('.data/intake-scale-20261017');
await mkdir(folder,{recursive:true});
const file=resolve(folder,'cadastre.json');
try{
 let snapshot;
 try{snapshot=cadastreSnapshotSchema.parse(JSON.parse(await readFile(file,'utf8')))}
 catch(e){
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  snapshot=await fetchFourCenterCadastre(75,20);
  await writeFile(file,JSON.stringify(snapshot),{flag:'wx'});
 }
 const geoFile=resolve(folder,'geography.json');
 try{await readFile(geoFile)}catch(e){
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  const geography=Object.fromEntries(await Promise.all(centerRegistry.map(async c=>[c.id,await fetchCenterGeography(c.id)])));
  await writeFile(geoFile,JSON.stringify(geography),{flag:'wx'});
 }
 console.log(JSON.stringify({file,count:snapshot.parcels.length,byCenter:snapshot.regions.map(r=>({id:r.centerId,pages:r.pagesRead,land:snapshot.parcels.filter(p=>p.centerId===r.centerId).reduce((a,p)=>({...a,[p.landCategory]:(a[p.landCategory]??0)+1}),{} as Record<string,number>)})),ownership:'FICTIONAL_INPUT_REQUIRED',area:'BOUNDARY_APPROXIMATION',population:'BOUNDED_SAMPLE_NOT_REGIONAL_STATISTIC'}));
}catch(e){console.error(e instanceof Error?e.message:'Provider acquisition failed');process.exitCode=1}
