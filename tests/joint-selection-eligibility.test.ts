import {it,expect} from 'vitest';
import {jointFeasibleSelectionRefs,jointWireTools} from '../lib/integrated-plan-adviser';
import type {JointEvaluation,JointSnapshot} from '../lib/integrated-plan';
const e=(hardLimitViolations:number,missingTasks:number,personHours:number)=>({metrics:{hardLimitViolations,missingTasks,personHours}} as JointEvaluation);
it('offers every feasible tradeoff while retaining infeasible alternatives in required evidence',()=>{
 const evaluated=new Map([['a',e(1,0,1)],['b',e(0,0,30)],['c',e(0,0,80)],['d',e(0,2,10)]]),refs=new Map([['E0','a'],['E1','b'],['E2','c'],['E3','d']]);
 const selectable=jointFeasibleSelectionRefs(evaluated,refs);expect(selectable).toEqual(['E1','E2']);
 const tool=jointWireTools({fields:[]} as unknown as JointSnapshot,refs.keys(),selectable)[1].function;
 expect(tool.parameters.properties.evaluationId.enum).toEqual(['E1','E2']);
 expect(tool.parameters.properties.assessments.required).toEqual(['E0','E1','E2','E3']);
 expect(evaluated.size).toBe(4);
});
it('does not invent a feasible result or pick a plan when all results are infeasible',()=>{
 const evaluated=new Map([['a',e(1,0,1)],['b',e(0,2,30)]]),refs=new Map([['E0','a'],['E1','b']]);
 expect(jointFeasibleSelectionRefs(evaluated,refs)).toEqual(['E0','E1']);
});
