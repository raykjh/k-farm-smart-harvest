import {it,expect} from 'vitest';
import {initialState,annualMissions} from '../lib/seed';
import {demoRemoval,clearedState,dataToken} from '../lib/demo-data';
it('identifies generated fields and dependent tasks without deleting data',()=>{const s=initialState();s.fields.forEach(f=>f.crop??='쌀');s.missions=annualMissions(s);const before=JSON.stringify(s);const result=demoRemoval(s);expect(result.safe).toBe(true);expect(result.fields).toBe(26);expect(result.tasks).toBe(546);expect(JSON.stringify(s)).toBe(before)});
it('refuses mixed provenance and unknown resources',()=>{const s=initialState();s.fields[0].source='MANUAL' as any;expect(demoRemoval(s).safe).toBe(false);const b=initialState();b.machines.push({...b.machines[0],id:'MANUAL'});expect(demoRemoval(b).safe).toBe(false)});
it('version token changes with edits and clear produces no fake resources',()=>{const s=initialState(),token=dataToken(s);s.fields[0].area++;expect(dataToken(s)).not.toBe(token);expect(clearedState().fields).toHaveLength(0);expect(clearedState().machines).toHaveLength(0)});
