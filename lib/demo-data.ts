import {createHash} from 'node:crypto';
import {initialState} from './seed';
import {demoMachineIds} from './registered-demo';
import type {State} from './types';
export function dataToken(state:State){return createHash('sha256').update(JSON.stringify(state)).digest('hex')}
export function demoRemoval(state:State){
 const fields=state.fields.filter(f=>f.source==='DEMO_ASSUMPTION');
 const ids=new Set(fields.map(f=>f.id));
 const machineIds=new Set([...initialState().machines.map(m=>m.id),...demoMachineIds]);
 const safe=state.fields.length===fields.length&&state.missions.every(m=>ids.has(m.fieldId))&&state.machines.every(m=>machineIds.has(m.id));
 return {safe,fields:fields.length,tasks:state.missions.length,equipment:state.machines.length,token:dataToken(state)};
}
export function clearedState():State{return {...initialState(),fields:[],missions:[],machines:[],events:[],revisions:[],staffCount:0,transportCount:0,ruleVersion:'UNCONFIGURED',registered:false,planned:false}}
