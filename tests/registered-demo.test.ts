import {expect,it} from 'vitest';
import {registeredDemo,demoEquipment} from './registered-demo-fixture';
import {demoRemoval} from '../lib/demo-data';
it('links thirty synthetic registrations and test parcel identities to crop calendars',()=>{
 const b=registeredDemo();expect(b.fields).toHaveLength(30);expect(b.consultations).toHaveLength(30);
 expect(new Set(b.fields.map(f=>f.pnu)).size).toBe(30);
 for(const c of b.consultations){expect(c.payload.farmer.name).toMatch(/^홍..$/);expect(c.payload.farmer.phone).toMatch(/^010-0000-\d{4}$/);expect(b.fields.find(f=>f.consultationId===c.id)?.pnu).toBe(c.payload.fields[0].pnu);expect(c.payload.consent).toBe(false);}
 for(const crop of ['rice','potato','pepper'])expect(b.fields.filter(f=>f.crop===crop)).toHaveLength(10);
 for(const [code] of demoEquipment)expect(b.state.machines.filter(m=>m.id.startsWith('JB23'+code))).toHaveLength(2);
 for(const f of b.state.fields){const tasks=b.state.missions.filter(m=>m.fieldId===f.id);expect(tasks[0].scheduledDate).toMatch(/^2026-01/);expect(tasks.at(-1)!.scheduledDate).toMatch(/^2026-12/);expect(tasks.map(t=>t.scheduledDate)).toEqual(tasks.map(t=>t.scheduledDate).sort());}
 expect(b.state.missions.filter(m=>m.crop==='감자'&&m.label==='감자 굴취').every(m=>m.scheduledDate!.startsWith('2026-06'))).toBe(true);
 expect(b.state.missions.every(m=>!m.resourceId||b.state.machines.some(x=>x.id===m.resourceId))).toBe(true);
 expect(demoRemoval(b.state).safe).toBe(true);
});
