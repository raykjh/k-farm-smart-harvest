import {writeFile} from 'node:fs/promises';
import {importJangsuAnnualNormals} from '../lib/climate-normal-import';
import {db} from '../lib/db';
try{const result=await importJangsuAnnualNormals({onProgress:n=>{if(n%31===0)console.log(JSON.stringify({collectedDays:n}));}});console.log(JSON.stringify(result));if(process.env.KFARM_CLIMATE_EVIDENCE_FILE)await writeFile(process.env.KFARM_CLIMATE_EVIDENCE_FILE,JSON.stringify(result,null,2));}catch(e){console.error(e instanceof Error?e.message:'Climate import failed');process.exitCode=1;}finally{await db.$disconnect();}
