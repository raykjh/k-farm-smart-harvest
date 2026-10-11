import {it,expect} from 'vitest';
import {initialState,annualMissions} from '../lib/seed';
import {weatherBlocked,restricted} from '../lib/weather';
it('job-specific limits, unknown fail closed, and stronger wind also restricts ground',()=>{
 const s=initialState();s.fields.forEach(f=>f.crop='감자');s.missions=annualMissions(s);s.events=[{id:'test',start:0,end:32,windMs:9,source:'DEMO_ASSUMPTION'}];
 const ground=s.missions.find(m=>m.id==='B-2')!,drone=s.missions.find(m=>m.id==='A-5')!;
 expect(weatherBlocked(s,drone)).toBe(true);expect(weatherBlocked(s,ground)).toBe(false);
 expect(restricted(s,{...ground,windLimitMs:5},s.events[0])).toBe(true);
 expect(restricted(s,{...ground,windLimitMs:undefined},s.events[0])).toBe(true);
 s.events[0].windMs=12;expect(weatherBlocked(s,ground)).toBe(true);
});
