import {it,expect,vi,afterEach} from 'vitest';
const mock=vi.hoisted(()=>vi.fn());
vi.mock('../lib/ai-budget',()=>({budgetedCompletion:mock,APPROVED_MODEL:'test-only'}));
import {adviseOperatingCrop,groundOperatingCropChoice,groundCropDecision,replayOperatingCrop,cropCandidateFingerprint} from '../lib/operating-crop-adviser';
const facts=[{id:'rice',crop:'rice',score:92,specialtyBonus:3,supplyPenalty:1,borrowedEquipmentTasks:2,personMinutes:300},{id:'potato',crop:'potato',score:92,specialtyBonus:0,supplyPenalty:0,borrowedEquipmentTasks:0,personMinutes:500}];
afterEach(()=>{vi.unstubAllEnvs();mock.mockReset()});
it('remains free even when the environment is live and selects a grounded feasible tradeoff',async()=>{
 vi.stubEnv('AI_MODE','nebius');expect(await adviseOperatingCrop(facts)).toMatchObject({candidateId:'potato',source:'RULES',inferenceCalled:false,approval:'REQUIRED',reserved:false});expect(mock).not.toHaveBeenCalled();
});
it('grounds model metric references, rejects fabricated IDs and numerical overrides',()=>{
 expect(groundOperatingCropChoice({candidateId:'rice',evidence:[{candidateId:'rice',metric:'personMinutes'}]},facts).evidence[0].value).toBe(300);
 expect(()=>groundOperatingCropChoice({candidateId:'apple',evidence:[{candidateId:'apple',metric:'score'}]},facts)).toThrow();
 expect(()=>groundOperatingCropChoice({candidateId:'rice',evidence:[{candidateId:'rice',metric:'score',value:999}]},facts)).toThrow();
});
it('accepts a valid model choice only through explicit opt-in; this test uses no external API',async()=>{
 vi.stubEnv('AI_MODE','nebius');const baseline=await adviseOperatingCrop(facts,false,'MIN_LABOR');
 mock.mockResolvedValue(response(asWire(baseline)));
 const result=await adviseOperatingCrop(facts,true,'MIN_LABOR');
 expect(result).toMatchObject({source:'NEBIUS',inferenceCalled:true,candidateId:'rice',reserved:false,rationaleCheck:{status:'VERIFIED'}});expect(mock).toHaveBeenCalledOnce();
 expect(mock).toHaveBeenCalledWith(expect.objectContaining({reasoning_effort:'low',max_tokens:2048,tool_choice:'auto'}),'crop-decision');
 const replay=replayOperatingCrop(result,[...facts].reverse());expect(replay).toMatchObject({source:'NEBIUS',inferenceCalled:false,replayed:true,candidateId:'rice'});expect(mock).toHaveBeenCalledOnce();
 expect(()=>replayOperatingCrop(result,facts.map(c=>({...c,personMinutes:c.personMinutes+1})))).toThrow('변경');
});
const asWire=(d:Awaited<ReturnType<typeof adviseOperatingCrop>>)=>({candidateId:d.candidateId,evidence:d.evidence.map(({candidateId,metric})=>({candidateId,metric})),rejections:d.rejections});
const response=(body:unknown,finish='tool_calls')=>({choices:[{finish_reason:finish,message:{tool_calls:[{function:{name:'choose_operating_crop',arguments:JSON.stringify(body)}}]}}]});
it('rejects priority mismatch, omitted rejections and wrong decisive metric instead of falling back',async()=>{
 const balanced=asWire(await adviseOperatingCrop(facts)),labor=asWire(await adviseOperatingCrop(facts,false,'MIN_LABOR'));
 expect(()=>groundCropDecision(labor,facts,'BALANCED')).toThrow('OPERATOR_REVIEW');
 expect(()=>groundCropDecision({...balanced,rejections:[]},facts,'BALANCED')).toThrow();
 expect(()=>groundCropDecision({...balanced,rejections:[{candidateId:'rice',metric:'score'}]},facts,'BALANCED')).toThrow();
 vi.stubEnv('AI_MODE','nebius');mock.mockResolvedValue(response(labor));await expect(adviseOperatingCrop(facts,true)).rejects.toThrow('OPERATOR_REVIEW');expect(mock).toHaveBeenCalledOnce();
});
it('keeps candidate order irrelevant, changes priority explicitly, and never double counts specialty',async()=>{
 const a=await adviseOperatingCrop(facts),b=await adviseOperatingCrop([...facts].reverse());
 expect(a.candidateId).toBe(b.candidateId);expect(a.candidateFingerprint).toBe(b.candidateFingerprint);
 expect((await adviseOperatingCrop(facts,false,'MIN_LABOR')).candidateId).toBe('rice');
 expect((await adviseOperatingCrop(facts.map(c=>({...c,specialtyBonus:999})))).candidateId).toBe('potato');
 expect(cropCandidateFingerprint(facts,'MIN_LABOR')).not.toBe(a.candidateFingerprint);
});
it('rejects truncated or missing tool output without retries; an empty feasible set is never sent',async()=>{
 vi.stubEnv('AI_MODE','nebius');expect((await adviseOperatingCrop([],true)).candidateId).toBeNull();expect(mock).not.toHaveBeenCalled();
 mock.mockResolvedValue(response(asWire(await adviseOperatingCrop(facts)),'length'));await expect(adviseOperatingCrop(facts,true)).rejects.toThrow('OPERATOR_REVIEW');expect(mock).toHaveBeenCalledOnce();
});
it('uses stable IDs only on complete metric ties and revalidates stored rejection evidence',async()=>{
 const tied=facts.map(c=>({...facts[0],id:c.id}));const d=await adviseOperatingCrop(tied);expect(d.candidateId).toBe('potato');expect(d.rejections).toEqual([{candidateId:'rice',metric:null}]);
 expect(()=>replayOperatingCrop({...d,source:'NEBIUS',rejections:[]},tied)).toThrow();
});
it.each([
 ['MIN_LABOR','personMinutes','MINIMIZE','score','borrowedEquipmentTasks'],
 ['MIN_EXTERNAL','borrowedEquipmentTasks','MINIMIZE','score','personMinutes'],
 ['BALANCED','score','MAXIMIZE','borrowedEquipmentTasks','personMinutes'],
] as const)('puts the actual %s ranked priority into the system instruction, not a fixed score-first list',async(priority,first,direction,second,third)=>{
 vi.stubEnv('AI_MODE','nebius');mock.mockResolvedValue(response(asWire(await adviseOperatingCrop(facts,false,priority))));
 await adviseOperatingCrop(facts,true,priority);
 const system=mock.mock.calls[0][0].messages[0].content as string;
 expect(system).toContain(`The operator selected ${priority}`);
 expect(system).toContain(JSON.stringify([
  {rank:1,metric:first,direction},
  {rank:2,metric:second,direction:second==='score'?'MAXIMIZE':'MINIMIZE'},
  {rank:3,metric:third,direction:'MINIMIZE'},
 ]));
 expect(system).toContain('use rank 2 ONLY when rank 1 is equal');
 expect(system).not.toContain('priorityOrder: MAXIMIZE score');
});
