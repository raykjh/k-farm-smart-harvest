import {randomBytes} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {setupApplicationOrigin} from '../lib/application-origin';
try{
 const origin=setupApplicationOrigin();
 if(await db.workRecord.count({where:{workspace:'auth',kind:'user'}}))throw Error('초기 계정이 이미 있습니다. 재설정하지 않았습니다.');
 const token=randomBytes(32).toString('hex');
 await db.workRecord.upsert({where:{workspace_kind_id:authKey('bootstrap','initial')},create:{...authKey('bootstrap','initial'),payload:{hash:digest(token),expiresAt:Date.now()+24*3600000}},update:{payload:{hash:digest(token),expiresAt:Date.now()+24*3600000}}});
 console.log(origin+'/login#setup='+token);
}finally{await db.$disconnect()}
