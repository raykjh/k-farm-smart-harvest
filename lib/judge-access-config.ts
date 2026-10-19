import {knownCenter} from './center-registry';
import {newPasswordSchema} from './password-policy';

export type JudgeLoginDefaults={username:string;password:string};
export type JudgeAccessConfig=JudgeLoginDefaults&{centerId:string};

// Runtime-only opt-in. Never reuse an operating DB or an administrator account.
export function judgeAccessConfig(env:Record<string,string|undefined>=process.env):JudgeAccessConfig|null{
 if(env.KFARM_JUDGE_ACCESS!=='1')return null;
 let database='';
 try{const url=new URL(env.DATABASE_URL??'');if(!['postgres:','postgresql:'].includes(url.protocol))throw Error();database=decodeURIComponent(url.pathname.slice(1));}catch{throw Error('Judge access requires an explicit isolated PostgreSQL database.');}
 if(!/^kfarm_judge(?:_verify_[a-z0-9_]+)?$/.test(database))throw Error('Judge access is restricted to the isolated judge database.');
 const username=env.KFARM_JUDGE_USERNAME??'',password=env.KFARM_JUDGE_PASSWORD??'',centerId=env.KFARM_JUDGE_CENTER_ID??'';
 if(!/^judge-[a-z0-9][a-z0-9_-]{1,80}$/.test(username)||!knownCenter(centerId)||!newPasswordSchema.safeParse(password).success)throw Error('Judge account settings are incomplete.');
 return {username,password,centerId};
}

export function judgeAccountEnabled(user:{judgeAccount?:true;username:string;role:string;centerId:string|null}){
 if(!user.judgeAccount)return true;
 try{const config=judgeAccessConfig();return !!config&&user.username===config.username&&user.role==='CENTER_ADMIN'&&user.centerId===config.centerId;}catch{return false}
}
