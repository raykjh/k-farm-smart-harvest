import {db} from './db';
import {centerRegistry} from './center-registry';
import {inCenter} from './workspace';
import {refreshProduction} from './production-service';

/** Both server and standalone worker run this same center-scoped draft refresh.
 * Each center commits independently; failure must not starve the other centers.
 * refreshProduction uses DB locks/fingerprints, never approves or sends notices. */
export async function refreshAllCenters(){
 const outcomes:{centerId:string;status:'REFRESHED'|'ABSENT'|'FAILED'}[]=[];
 for(const center of centerRegistry){
  try{
   if(!await db.center.findUnique({where:{id:center.id}})){outcomes.push({centerId:center.id,status:'ABSENT'});continue;}
   await inCenter(center.id,()=>db.$transaction(tx=>refreshProduction(tx),{timeout:60000}));
   outcomes.push({centerId:center.id,status:'REFRESHED'});
  }catch{
   outcomes.push({centerId:center.id,status:'FAILED'});
   console.error(`Production draft refresh failed for ${center.id}; existing plans preserved.`);
  }
 }
 return outcomes;
}
