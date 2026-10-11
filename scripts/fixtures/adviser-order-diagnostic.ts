import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {decisionMetrics,priorityMetrics,type DecisionPriority} from '../../lib/planning-priority';

// Diagnostic-only request transformations. Never imported by the application.
export const diagnosticFolder='.data/validation/20261005-ai-order-diagnostics';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type DiagnosticBody=Record<string,any>;
export function requestOrders(body:DiagnosticBody){
 const facts=JSON.parse(body.messages[1].content),properties=body.tools[0].function.parameters.properties;
 return {alternatives:facts.alternatives.map((a:any)=>a.id),eligibleIds:facts.eligibleIds,
  selectionEnum:properties.alternativeId.enum,evidenceEnum:properties.evidence.items.properties.alternativeId.enum};
}
export function diagnosticVariants(original:DiagnosticBody){
 const variants=[
  {id:'BASELINE',reverseFacts:false,reverseSchema:false,explicitPriority:false},
  {id:'FACTS_REVERSED',reverseFacts:true,reverseSchema:false,explicitPriority:false},
  {id:'SCHEMA_REVERSED',reverseFacts:false,reverseSchema:true,explicitPriority:false},
  {id:'BOTH_REVERSED',reverseFacts:true,reverseSchema:true,explicitPriority:false},
  {id:'EXPLICIT_LEXICOGRAPHIC',reverseFacts:false,reverseSchema:false,explicitPriority:true},
 ];
 return variants.map(v=>{
  const body=structuredClone(original);
  if(v.reverseFacts){const facts=JSON.parse(body.messages[1].content);facts.alternatives.reverse();facts.eligibleIds.reverse();body.messages[1].content=JSON.stringify(facts);}
  if(v.reverseSchema){const p=body.tools[0].function.parameters.properties;p.alternativeId.enum.reverse();p.evidence.items.properties.alternativeId.enum.reverse();}
  if(v.explicitPriority)body.messages[0].content+=' Interpret priorityOrder as a STRICT LEXICOGRAPHIC comparison, not a weighted sum. Compare all eligible alternatives on the first metric; keep only the lowest values. Compare the next metric only among alternatives still tied, and repeat in order. A benefit on a later metric NEVER compensates for a worse earlier metric. If all metrics tie, prefer scope PRESERVE, then AUTO, then EXPAND, then ascending alternative ID. The order of alternatives, eligibleIds and enum values does not express preference. Compare the numeric values before selecting. Do not sum days, equipment minutes and person-minutes.';
  return {...v,body,requestHash:digest(body),orders:requestOrders(body)};
 });
}
const selection=z.object({alternativeId:z.string().min(1).max(80),evidence:z.array(z.object({alternativeId:z.string().min(1).max(80),metric:z.enum(decisionMetrics)}).strict()).min(1).max(8)}).strict();
export function assessDiagnosticResponse(body:DiagnosticBody,response:any){
 const facts=JSON.parse(body.messages[1].content);
 assert.deepEqual(facts.priorityOrder,priorityMetrics(facts.operatorPriority as DecisionPriority,facts.preferredDateRequested));
 const eligible=facts.alternatives.filter((a:any)=>a.status==='FEASIBLE'&&facts.eligibleIds.includes(a.id));
 assert(eligible.length>1);
 const keys=facts.priorityOrder as typeof decisionMetrics[number][];
 assert(eligible.every((a:any)=>keys.every(k=>Number.isFinite(a.metrics[k]))));
 const scopeCost=(a:any)=>a.scope==='PRESERVE'?0:a.scope==='EXPAND'?2:1;
 const best=[...eligible].sort((a:any,b:any)=>{for(const k of keys){const delta=a.metrics[k]-b.metrics[k];if(delta)return delta;}return scopeCost(a)-scopeCost(b)||a.id.localeCompare(b.id);})[0];
 const calls=response.choices?.[0]?.message?.tool_calls;
 assert.equal(calls?.length,1,'Exactly one tool call required');
 assert.equal(calls[0].function?.name,'recommend_alternative');
 assert.notEqual(response.choices[0].finish_reason,'length','Truncated model answer');
 const rawArguments=calls[0].function.arguments,answer=selection.parse(JSON.parse(rawArguments));
 const chosen=eligible.find((a:any)=>a.id===answer.alternativeId);
 assert(chosen,'Only eligible alternatives may be selected');
 assert(answer.evidence.some(e=>e.alternativeId===answer.alternativeId),'Own evidence required');
 const evidence=answer.evidence.map(e=>{
  const a=facts.alternatives.find((a:any)=>a.id===e.alternativeId);
  assert(a?.status==='FEASIBLE'&&Number.isFinite(a.metrics[e.metric]));
  return {...e,value:a.metrics[e.metric]};
 });
 const metric=keys.find(k=>chosen.metrics[k]!==best.metrics[k]);
 return {selected:chosen.id,ruleChoice:best.id,priorityAligned:!metric,
  firstDifference:metric?{metric,selected:chosen.metrics[metric],rule:best.metrics[metric]}:null,
  pickedFirstFact:chosen.id===facts.eligibleIds[0],pickedFirstSchema:chosen.id===requestOrders(body).selectionEnum[0],
  evidence,rawArguments,finishReason:response.choices[0].finish_reason??null,responseModel:response.model??null};
}
