import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const mocks=vi.hoisted(()=>({find:vi.fn(),many:vi.fn(),create:vi.fn(),first:vi.fn(),transaction:vi.fn(),execute:vi.fn(),center:vi.fn(),audit:vi.fn()}));
vi.mock('../lib/db',()=>({db:{workRecord:{findUnique:mocks.find,findMany:mocks.many,findFirst:mocks.first,create:mocks.create},$transaction:mocks.transaction}}));
import {judgeAccessConfig,judgeAccountEnabled} from '../lib/judge-access-config';
import {judgeLoginDefaults} from '../lib/judge-access';
import {provisionJudgeAccount} from '../lib/judge-account-provision';
import {permitted} from '../lib/auth-policy';
import {asPrincipal,passwordHash,authenticate,changePassword,type User} from '../lib/auth';
import {centerId} from '../lib/workspace';
import {POST as authPost} from '../app/api/auth/route';
import {GET as accountsGet,POST as accountsPost} from '../app/api/accounts/route';
import Login from '../components/login';
import {LanguageProvider} from '../components/language';

const env={KFARM_JUDGE_ACCESS:'1',DATABASE_URL:'postgresql://test:unused@localhost/kfarm_judge_verify_access',KFARM_JUDGE_USERNAME:'judge-gyebuk',KFARM_JUDGE_PASSWORD:'FixtureOnly-4xR!9',KFARM_JUDGE_CENTER_ID:'demo'};
let user:User;
beforeEach(async()=>{
 vi.clearAllMocks();for(const[k,v]of Object.entries(env))vi.stubEnv(k,v);
 vi.stubEnv('KFARM_APP_ORIGIN','https://judge.example');
 vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Network forbidden in judge-access unit tests.')}));
 user={id:'public-judge-gyebuk',username:env.KFARM_JUDGE_USERNAME,name:'Judge fixture',role:'CENTER_ADMIN',centerId:'demo',enabled:true,passwordHash:await passwordHash(env.KFARM_JUDGE_PASSWORD),mustChangePassword:false,judgeAccount:true};
 mocks.find.mockImplementation(async(arg:any)=>arg.where.workspace_kind_id.kind==='session'?{payload:{userId:user.id,expiresAt:Date.now()+60_000}}:{payload:user});
 mocks.many.mockResolvedValue([]);mocks.first.mockResolvedValue(null);mocks.center.mockResolvedValue({id:'demo'});
 mocks.transaction.mockImplementation(fn=>fn({$executeRaw:mocks.execute,center:{findUnique:mocks.center},workRecord:{findMany:mocks.many,findFirst:mocks.first,create:mocks.create},audit:{create:mocks.audit}}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});

describe('isolated public judge access',()=>{
 it('is off by default and rejects an operating DB, invalid password or unknown center',()=>{
  expect(judgeAccessConfig({})).toBeNull();
  for(const bad of [{DATABASE_URL:'postgresql://test@localhost/kfarm'},{DATABASE_URL:'postgresql://test@localhost/kfarm_test'},{KFARM_JUDGE_USERNAME:'admin'},{KFARM_JUDGE_CENTER_ID:'unknown'},{KFARM_JUDGE_PASSWORD:'1234'}])expect(()=>judgeAccessConfig({...env,...bad})).toThrow();
  expect(judgeAccessConfig(env)).toEqual({username:env.KFARM_JUDGE_USERNAME,password:env.KFARM_JUDGE_PASSWORD,centerId:'demo'});
 });
 it('reveals defaults only for the provisioned matching public account, without writes or inference',async()=>{
  expect(await judgeLoginDefaults()).toEqual({username:env.KFARM_JUDGE_USERNAME,password:env.KFARM_JUDGE_PASSWORD});
  expect(mocks.transaction).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  for(const change of [{judgeAccount:undefined},{enabled:false},{deletedAt:'2026-10-18'},{mustChangePassword:true},{role:'SUPER_ADMIN'},{centerId:'janggye'},{passwordHash:await passwordHash('Different-Fixture-91!')}]){
   mocks.find.mockResolvedValueOnce({payload:{...user,...change}});expect(await judgeLoginDefaults()).toBeNull();
  }
 });
 it('keeps the normal Korean blank login and renders English judge inputs in the same form',()=>{
  const normal=renderToStaticMarkup(createElement(LanguageProvider,{children:createElement(Login)}));
  expect(normal).toContain('placeholder="아이디"');expect(normal).not.toContain(env.KFARM_JUDGE_PASSWORD);
  const judge=renderToStaticMarkup(createElement(LanguageProvider,{defaultLocale:'en',children:createElement(Login,{defaultCredentials:{username:env.KFARM_JUDGE_USERNAME,password:env.KFARM_JUDGE_PASSWORD}})}));
  expect(judge).toContain('Sign in');expect(judge).toContain('value="judge-gyebuk"');expect(judge).toContain(`value="${env.KFARM_JUDGE_PASSWORD}"`);expect(judge).not.toContain('Sign up');expect(fetch).not.toHaveBeenCalled();
 });
 it('preserves scoped operations but denies resets and account controls',()=>{
  for(const[path,method,body]of [['workspace','GET',null],['consultations','POST',{}],['continuous-production','POST',{action:'approve'}],['replanning','POST',{action:'automatic'}],['equipment','POST',{}],['labor-operations','POST',{action:'saveAttendance'}]] as const)expect(permitted(user,path,method,body)).toBe(true);
  for(const[path,method,body]of [['accounts','GET',null],['demo','GET',null],['demo-data','POST',{}],['workspace','POST',{action:'initialize'}],['center-settings','POST',{}],['replanning','POST',{action:'reset'}]] as const)expect(permitted(user,path,method,body)).toBe(false);
  expect(asPrincipal(user,()=>centerId())).toBe('demo');
 });
 it('blocks public credential/profile/account changes on actual route handlers',async()=>{
  const headers={host:'judge.example',origin:'https://judge.example',cookie:'kfarm_session='+'a'.repeat(64),'content-type':'application/json'};
  for(const action of ['changePassword','saveProfile','requestRecovery','recoveryCode','signup','setup','recover'])expect((await authPost(new Request('https://judge.example/api/auth',{method:'POST',headers,body:JSON.stringify({action})}))).status).toBe(403);
  expect((await accountsGet(new Request('https://judge.example/api/accounts',{headers}))).status).toBe(403);
  expect((await accountsPost(new Request('https://judge.example/api/accounts',{method:'POST',headers,body:'{"action":"create"}'}))).status).toBe(403);
  await expect(changePassword(user,{})).rejects.toThrow('Public trial');expect(mocks.create).not.toHaveBeenCalled();
 });
 it('invalidates judge authentication when judge access is disabled or the configured center changes',async()=>{
  const req=new Request('https://judge.example',{headers:{cookie:'kfarm_session='+'b'.repeat(64)}});
  expect((await authenticate(req))?.judgeAccount).toBe(true);
  vi.stubEnv('KFARM_JUDGE_ACCESS','0');expect(await authenticate(req)).toBeNull();expect(judgeAccountEnabled({...user,judgeAccount:undefined})).toBe(true);
  vi.stubEnv('KFARM_JUDGE_ACCESS','1');vi.stubEnv('KFARM_JUDGE_CENTER_ID','janggye');expect(await authenticate(req)).toBeNull();
 });
 it('provisions only a new judge account, preserves existing accounts and is idempotent',async()=>{
  expect((await provisionJudgeAccount()).created).toBe(true);expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0].data.payload).toMatchObject({judgeAccount:true,role:'CENTER_ADMIN',centerId:'demo',mustChangePassword:false});
  mocks.many.mockResolvedValue([{id:user.id,payload:user}]);expect((await provisionJudgeAccount()).created).toBe(false);expect(mocks.create).toHaveBeenCalledTimes(1);
  mocks.many.mockResolvedValue([{id:'existing-admin',payload:{...user,role:'SUPER_ADMIN',judgeAccount:undefined}}]);await expect(provisionJudgeAccount()).rejects.toThrow('overwritten');expect(mocks.create).toHaveBeenCalledTimes(1);
 });
});
