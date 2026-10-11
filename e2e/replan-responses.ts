// UI contract fixtures only. Scheduling correctness is covered separately by
// planning-decision.test.ts against the real Python solver.
export function comparedPlans(input:any){
 const day=input.preferred??'2026-10-01';
 const slot=(date:string)=>Math.round((Date.parse(date)-Date.parse('2026-01-01'))/86400000)*32;
 return {source:'DEVELOPMENT_REVIEW',inferenceCalled:false,approval:'REQUIRED',reserved:false,
  snapshot:{id:'a'.repeat(64),asOf:day,planVersion:1,ruleVersion:'UI_TEST',requestHash:'b'.repeat(64)},nonDominatedIds:['preserve','expand'],
  results:input.alternatives.map((a:any,i:number)=>{
   const {alternatives,action,...base}=input;
   const expanded=a.scope==='EXPAND';
   const date=expanded?day:new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
   const diff=[{id:input.ids[0],before:slot(day)-32,after:slot(date),date,beforeResource:'JB23TR01',afterResource:'JB23TR01'},
    ...(expanded?[{id:'ui-2',label:'인접 농지 작업',address:'계북면',before:slot(day),after:slot(date)+32,date:new Date(Date.parse(date)+86400000).toISOString().slice(0,10),beforeResource:'JB23TR01',afterResource:'JB23TR01'}]:[])];
   return {id:a.id,label:a.label,status:'FEASIBLE',metrics:{changedTasks:diff.length,otherChangedTasks:expanded?1:0,resourceChanges:0,shiftDays:2,preferredDistanceDays:input.preferred&&!expanded?1:0,borrowedEquipmentMinutes:a.id==='equipment'?240:0,supportPersonMinutes:a.id==='labor'?240:0},
    warnings:[],result:{status:'FEASIBLE',diff,assignments:diff.map(d=>({id:d.id,start:d.after})),phase:expanded?'REBUILD_APPROVED':'GAPS_ONLY',preferredSatisfied:expanded,warnings:[]},
    previewRequest:{...base,action:'preview',scope:a.scope,...(a.newLaborSupport===false?{newLaborSupport:false}:{}),...(a.replacement==='NONE'?{automaticReplacement:false}:{}),decisionSource:'DEVELOPMENT_REVIEW',comparisonSnapshot:'a'.repeat(64)}};
  })};
}
