import {describe,it,expect} from 'vitest';
import {allocateLabor,rankLabor,type LaborCandidate} from '../lib/labor';
const p=(id:string,patch:Partial<LaborCandidate>={}):LaborCandidate=>({id,name:id,score:100,distanceKm:1,recentAssignments:0,eligible:true,response:'APP',...patch});
describe('labor allocation',()=>{
 it('excludes silent and unsuitable people',()=>expect(rankLabor([p('a',{response:'NONE'}),p('b',{eligible:false}),p('c',{response:'PHONE'})]).map(x=>x.id)).toEqual(['c']));
 it('prioritizes score then distance then fewer assignments',()=>expect(rankLabor([p('a',{score:90,distanceKm:0}),p('b',{distanceKm:3}),p('c',{recentAssignments:2}),p('d')]).map(x=>x.id)).toEqual(['d','c','b','a']));
 it('puts unknown distance after known, preserves input and caps allocation',()=>{const input=[p('a',{distanceKm:null}),p('b')];expect(allocateLabor(input,1).selected[0].id).toBe('b');expect(input[0].id).toBe('a');expect(allocateLabor(input,3).shortage).toBe(1)});
 it('rejects invalid demand',()=>expect(()=>allocateLabor([],0)).toThrow());
});
