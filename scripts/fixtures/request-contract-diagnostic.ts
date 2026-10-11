import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {groundPlanningSelection} from '../../lib/planning-adviser';
import {RATIONALE_VERSION,rationaleContext} from '../../lib/planning-rationale';
import type {compareReplanAlternatives} from '../../lib/planning-decision';

// Diagnostic transforms only; never imported by an application request handler.
export const requestDiagnosticFolder='.data/validation/20261005-request-contract';
export type Body=Record<string,any>;
export type Comparison=Awaited<ReturnType<typeof compareReplanAlternatives>>;
export type Method='forced'|'auto';
export type Effort='none'|'low';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function settings(original:Body,method:Method,effort:Effort,maxTokens:number){
 const body=structuredClone(original);
 body.tool_choice=method==='auto'?'auto':{type:'function',function:{name:'recommend_alternative'}};
 body.reasoning_effort=effort;body.max_tokens=maxTokens;
 return body;
}
export function ordered(original:Body,factsReversed:boolean,schemaReversed:boolean){
 const body=structuredClone(original);
 if(factsReversed){
  const facts=JSON.parse(body.messages[1].content);
  facts.alternatives.reverse();facts.eligibleIds.reverse();body.messages[1].content=JSON.stringify(facts);
 }
 if(schemaReversed){
  const p=body.tools[0].function.parameters.properties;
  p.alternativeId.enum.reverse();
  p.evidence.items.properties.alternativeId.enum.reverse();
  p.rejections.items.properties.alternativeId.enum.reverse();
 }
 return body;
}
export function compact(original:Body){
 const body=structuredClone(original),fn=body.tools[0].function,p=fn.parameters;
 delete p.properties.contractVersion;delete p.properties.selectionReason;
 p.required=p.required.filter((k:string)=>k!=='contractVersion'&&k!=='selectionReason');
 const legacy='Return contractVersion, selectionReason (ONLY_ELIGIBLE if one eligible ID, otherwise COMPARATIVE), and a rejection for EVERY other alternative exactly once, including infeasible ones.';
 assert(body.messages[0].content.includes(legacy),'Unexpected source prompt; do not silently transform it');
 body.messages[0].content=body.messages[0].content.replace(legacy,'Return alternativeId, evidence, and a rejection for EVERY other alternative exactly once, including infeasible ones. Contract version and eligible-count metadata are computed by the server; do not return them.');
 return body;
}
export function assess(comparison:Comparison,response:any,wire:'legacy'|'compact'='legacy'){
 const calls=response.choices?.[0]?.message?.tool_calls;
 assert.equal(calls?.length,1,'Exactly one tool call required');
 assert.equal(calls[0].function?.name,'recommend_alternative');
 assert.equal(response.choices[0].finish_reason,'tool_calls','No truncated or text-only result accepted');
 const raw=JSON.parse(calls[0].function.arguments),context=rationaleContext(comparison);
 if(wire==='compact'){
  assert(!Object.hasOwn(raw,'contractVersion')&&!Object.hasOwn(raw,'selectionReason'),'Compact answer must not invent server metadata');
  assert(Array.isArray(raw.rejections),'Missing rejection reasons');
 }
 const grounded=groundPlanningSelection(comparison,wire==='compact'?{...raw,contractVersion:RATIONALE_VERSION,selectionReason:context.feasible.length===1?'ONLY_ELIGIBLE':'COMPARATIVE'}:raw,'MODEL');
 return {selected:grounded.alternativeId,expected:context.ranked[0].id,priorityAligned:grounded.alternativeId===context.ranked[0].id,
  rationaleVerified:grounded.rationaleCheck.status==='VERIFIED',metadataSource:wire==='compact'?'SERVER':'MODEL',
  passed:grounded.alternativeId===context.ranked[0].id&&grounded.rationaleCheck.status==='VERIFIED',grounded};
}
// Predeclared selection rule. Ties prefer auto/none; never choose by array order.
export function chooseMethod(cases:any[]):Method{
 const score=(method:Method)=>{const a=cases.find(c=>c.method===method)?.assessment;return a?(a.passed?2:a.priorityAligned?1:0):0;};
 return score('forced')>score('auto')?'forced':'auto';
}
export function chooseEffort(cases:any[]):Effort{
 const off=cases.find(c=>c.effort==='none'),on=cases.find(c=>c.effort==='low');
 // A parameter being accepted is not proof that thinking was enabled.
 return on?.reasoningTokens>0&&on?.assessment?.passed&&!off?.assessment?.passed?'low':'none';
}
