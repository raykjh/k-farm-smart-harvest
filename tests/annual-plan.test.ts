import {it,expect} from 'vitest';
import {buildAnnualPlan} from '../lib/annual-plan';
import type {FieldEntry} from '../lib/field-record';
const f:FieldEntry={pnu:'5274036023106160004',address:'Test',crop:'rice',group:'G',area:3000,mode:'joint',rights:'pending'};
it('creates distinct tasks per parcel, no fabricated dates or resources',()=>{const plan=buildAnnualPlan([f,{...f,pnu:'5274036023102760001'}],2028,3);expect(plan.taskCount).toBe(20);expect(new Set(plan.plots.flatMap(p=>p.tasks.map(t=>t.id))).size).toBe(20);expect(plan.plots.every(p=>p.tasks.every(t=>t.date===null&&t.equipmentId===null))).toBe(true);expect(plan.dispatchStatus).toBe('BLOCKED');expect(plan.fieldVersion).toBe(3)});
it('reports missing crop and rejects empty input',()=>{expect(buildAnnualPlan([f,{...f,pnu:'x',crop:''}],2027,1).excluded).toEqual([{pnu:'x',reason:'CROP_REQUIRED'}]);expect(()=>buildAnnualPlan([],2027,0)).toThrow()});
