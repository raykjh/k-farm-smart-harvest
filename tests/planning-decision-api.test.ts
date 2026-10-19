import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {NextRequest} from 'next/server';
import {registeredDemo} from './registered-demo-fixture';
import {permitted} from '../lib/auth-policy';
import type {Principal} from '../lib/auth';
const mocks=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),decision:vi.fn(),readDecision:vi.fn(),history:vi.fn(async()=>[]),calculate:vi.fn(),complete:vi.fn(),agent:vi.fn(()=>{throw Error('Inference path must not be used')}),auth:vi.fn()}));
vi.mock('../lib/ai-budget',()=>({APPROVED_MODEL:'test-only',budgetedCompletion:mocks.complete}));
vi.mock('../lib/db',()=>({db:{center:{findUniqueOrThrow:mocks.read},workRecord:{create:mocks.decision,findUnique:mocks.readDecision},$queryRaw:mocks.history,$executeRaw:mocks.write}}));
vi.mock('../lib/center-settings-store',()=>({readCenterWeatherConfig:async()=>({})}));
vi.mock('../lib/center-resources',()=>({resourceView:async(_db:unknown,state:unknown)=>state}));
vi.mock('../lib/auth-route',()=>({withAuth:(_path:string,handler:unknown)=>{mocks.auth(_path);return handler}}));
vi.mock('../lib/annual-planning-agent',()=>({proposeAnnualReplan:mocks.agent}));
vi.mock('../lib/annual-replanning',async()=>({...await vi.importActual('../lib/annual-replanning'),calculateAnnualReplan:mocks.calculate}));
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',kind:'short',points:[],sourceUrl:'test',fetchedAt:'2026-09-28'})}));
import {POST} from '../app/api/replanning/route';
const call=(body:unknown)=>POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100','Content-Type':'application/json'},body:JSON.stringify(body)}));
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-28T07:00:00+09:00'));vi.stubEnv('AI_MODE','demo');
 mocks.decision.mockImplementation(async({data})=>{mocks.readDecision.mockResolvedValue(data);return data});
 mocks.read.mockResolvedValue({state:registeredDemo().state});mocks.calculate.mockResolvedValue({status:'FEASIBLE',diff:[],assignments:[],warnings:[],phase:'GAPS_ONLY'});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs()});
it('stores only the comparison review, then submits a selected result without paid inference or plan mutation',async()=>{
 const compared=await call({action:'compare',ids:['task'],reason:'검증',alternatives:[{id:'preserve',label:'유지',scope:'PRESERVE'}]});
 expect(compared.status).toBe(200);const body=await compared.json();expect(body.inferenceCalled).toBe(false);expect(mocks.write).not.toHaveBeenCalled();
 expect(mocks.decision).toHaveBeenCalledOnce();expect(body.recommendation.inferenceCalled).toBe(false);
 expect(body.baseline.alternativeId).toBe(body.recommendation.alternativeId);
 const preview=await call(body.results[0].previewRequest);expect(preview.status).toBe(200);
 const result=await preview.json();expect(result.source).toBe('DEVELOPMENT_REVIEW');expect(result.proposalId).toBeTruthy();
 expect(mocks.write).toHaveBeenCalledOnce();expect(mocks.agent).not.toHaveBeenCalled();
});
it('never infers paid-call consent from live mode alone',async()=>{
 vi.stubEnv('AI_MODE','nebius');
 const response=await call({action:'compare',ids:['task'],alternatives:[{id:'one',label:'one'}]});
 expect(response.status).toBe(200);expect((await response.json()).inferenceCalled).toBe(false);
 expect(mocks.complete).not.toHaveBeenCalled();
});
it('carries the resource restriction through strict preview and refuses changing it after comparison',async()=>{
 const response=await call({action:'compare',ids:['task'],decisionPriority:'MIN_EXTERNAL',alternatives:[{id:'local',label:'현재 자원',newLaborSupport:false,replacement:'NONE'}]});
 expect(response.status).toBe(200);const body=await response.json(),preview=body.results[0].previewRequest;
 expect(preview).toMatchObject({newLaborSupport:false,automaticReplacement:false,decisionPriority:'MIN_EXTERNAL'});
 expect((await call({...preview,newLaborSupport:true})).status).toBe(409);
 expect(mocks.write).not.toHaveBeenCalled();
 expect((await call(preview)).status).toBe(200);
 expect(mocks.calculate.mock.calls.at(-1)![1]).toMatchObject({newLaborSupport:false,automaticReplacement:false});
});
it('explicit AI comparison stores grounded advice alongside the baseline without approval',async()=>{
 vi.stubEnv('AI_MODE','nebius');
 mocks.complete.mockResolvedValue({choices:[{message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify({alternativeId:'one',evidence:[{alternativeId:'one',metric:'shiftDays'}],rejections:[]})}}]}}]});
 const response=await call({action:'compare',ids:['task'],useAi:true,alternatives:[{id:'one',label:'one'}]});
 expect(response.status).toBe(200);const body=await response.json();
 expect(body).toMatchObject({source:'NEBIUS',inferenceCalled:true,approval:'REQUIRED',reserved:false});
 expect(body.baseline.source).toBe('RULES');expect(body.recommendation.source).toBe('NEBIUS');
 expect(mocks.complete).toHaveBeenCalledOnce();expect(mocks.write).not.toHaveBeenCalled();expect(mocks.decision).toHaveBeenCalledOnce();
 expect(body.recommendation.rationaleCheck.status).toBe('VERIFIED');
 const preview=await(await call(body.results[0].previewRequest)).json();
 expect(preview.decision.selectionBasis).toBe('VERIFIED_AI');
 expect(mocks.write).toHaveBeenCalledOnce();
});
it('retains failed rationale in the review and records explicit selection as operator review without promoting it',async()=>{
 vi.stubEnv('AI_MODE','nebius');mocks.complete.mockResolvedValue({choices:[{message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify({alternativeId:'one',evidence:[{alternativeId:'one',metric:'shiftDays'}]})}}]}}]});
 const response=await call({action:'compare',ids:['task'],useAi:true,alternatives:[{id:'one',label:'one'}]});
 expect(response.status).toBe(200);const body=await response.json();
 expect(body.recommendation.rationaleCheck.status).toBe('INVALID');expect(body.recommendation.source).toBe('NEBIUS');
 expect(mocks.decision.mock.calls[0][0].data.payload.recommendation.rationaleCheck.status).toBe('INVALID');expect(mocks.write).not.toHaveBeenCalled();
 const preview=await(await call(body.results[0].previewRequest)).json();
 expect(preview.decision.selectionBasis).toBe('OPERATOR_REVIEW');expect(preview.decision.recommendation.rationaleCheck.status).toBe('INVALID');
 expect(mocks.complete).toHaveBeenCalledOnce();
});
it('does not save model-authored invalid choices or claim that they are a rule fallback',async()=>{
 vi.stubEnv('AI_MODE','nebius');mocks.complete.mockResolvedValue({choices:[{message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify({alternativeId:'invented',evidence:[{alternativeId:'invented',metric:'shiftDays'}]})}}]}}]});
 const response=await call({action:'compare',ids:['task'],useAi:true,alternatives:[{id:'one',label:'one'}]});
 expect(response.status).toBe(409);expect(mocks.decision).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
});
it('rejects an old comparison when the source plan changes before preview',async()=>{
 const body=await(await call({action:'compare',ids:['task'],alternatives:[{id:'one',label:'one'}]})).json();
 mocks.read.mockResolvedValue({state:{...registeredDemo().state,planVersion:999}});
 const result=await call(body.results[0].previewRequest);expect(result.status).toBe(409);expect((await result.json()).error).toContain('비교 이후');
 expect(mocks.write).not.toHaveBeenCalled();expect(mocks.agent).not.toHaveBeenCalled();
});
it('refuses capacity injection while allowing home-center staff to apply a verified replan',async()=>{
 const response=await call({action:'compare',ids:['task'],alternatives:[{id:'one',label:'one',staff:999}]});
 expect(response.status).toBe(409);expect(mocks.calculate).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
 const staff={role:'CENTER_STAFF',centerId:'demo'} as Principal;
 expect(permitted(staff,'replanning','POST',{action:'compare'})).toBe(true);
 expect(permitted(staff,'replanning','POST',{action:'approve'})).toBe(true);
 expect(permitted({...staff,centerId:'other'},'replanning','POST',{action:'compare'})).toBe(false);
});
