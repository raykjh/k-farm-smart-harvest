import {randomUUID,randomBytes} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,digest,type Principal} from '../lib/auth';
export const testPrincipal:Principal={id:'test-operator',username:'test',name:'Test',role:'CENTER_ADMIN',centerId:'demo',enabled:true};
export async function testSession(role:Principal['role']='CENTER_ADMIN',centerId:string|null='demo'){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB only');
 const id=randomUUID(),token=randomBytes(32).toString('hex');
 await db.workRecord.create({data:{...authKey('user',id),payload:{...testPrincipal,id,role,centerId,passwordHash:'not-a-password-login'}}});
 await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.parse('2099-01-01')}}});
 return {id,token,headers:{cookie:`kfarm_session=${token}`,host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100'},cleanup:()=>db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id},{kind:'session',id:digest(token)}]}})};
}
