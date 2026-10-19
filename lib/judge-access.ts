import {db} from './db';
import {authKey,passwordMatches,type User} from './auth';
import {judgeAccessConfig,type JudgeLoginDefaults} from './judge-access-config';

// Only the explicitly provisioned public trial credential may reach the client.
// No account is created, no session is started, and no AI runs on a page view.
export async function judgeLoginDefaults():Promise<JudgeLoginDefaults|null>{
 const config=judgeAccessConfig();if(!config)return null;
 const row=await db.workRecord.findUnique({where:{workspace_kind_id:authKey('user','public-'+config.username)}});
 const user=row?.payload as User|undefined;
 if(!user||user.judgeAccount!==true||user.username!==config.username||user.role!=='CENTER_ADMIN'||user.centerId!==config.centerId||!user.enabled||user.deletedAt||user.mustChangePassword)return null;
 if(!await passwordMatches(config.password,user.passwordHash))return null;
 return {username:config.username,password:config.password};
}
