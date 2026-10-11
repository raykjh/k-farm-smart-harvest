// Local owner-authorized bootstrap. Read credentials from stdin; never persist them.
import {createInterface} from 'node:readline';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {db} from '../lib/db';
import {authKey,digest,createAccount} from '../lib/auth';
import {issueRecoveryCode} from '../lib/account-recovery';
const reader=createInterface({input:process.stdin});
console.log('Waiting for initial account details on stdin.');
try{
 const line=await new Promise<string>(done=>reader.once('line',done));reader.close();const account=JSON.parse(line);
 if(await db.workRecord.count({where:{workspace:'auth',kind:'user'}}))throw Error('Existing accounts found; nothing overwritten.');
 const token=randomBytes(32).toString('hex');await db.workRecord.upsert({where:{workspace_kind_id:authKey('bootstrap','initial')},create:{...authKey('bootstrap','initial'),payload:{hash:digest(token),expiresAt:Date.now()+60000}},update:{payload:{hash:digest(token),expiresAt:Date.now()+60000}}});
 const user=await createAccount({...account,role:'SUPER_ADMIN',centerId:null},null,token,true);
 const code=await issueRecoveryCode(user,account.password);
 const dir=resolve('.data/account-recovery');await mkdir(dir,{recursive:true});const path=resolve(dir,`admin-${Date.now()}.txt`);
 await writeFile(path,`K-Farm one-time super administrator recovery\nUsername: ${user.username}\nRecovery code: ${code}\nKeep this file offline and private. Anyone holding this code can reset the password.\nAfter use, the old code is invalid. Save the replacement code.\n`,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({created:true,username:user.username,role:user.role,mustChangePassword:user.mustChangePassword,recoveryFile:path}));
}catch(e){console.error(e instanceof Error?e.message:'Provision failed');process.exitCode=1}finally{reader.close();await db.$disconnect()}
