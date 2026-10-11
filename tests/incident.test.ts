import {it,expect} from 'vitest';
import {affectedByIncident} from '../lib/incident';
import {registeredDemo} from './registered-demo-fixture';
it('selects actual drone missions for wind, preserves ground and completed work',()=>{
 const s=registeredDemo().state,drone=s.missions.find(m=>m.resourceId==='JB23DR01')!,ground=s.missions.find(m=>m.resourceId==='JB23TR01')!;
 // Keep each operation's own weather tolerances instead of copying a
 // consultation and changing only its label/equipment code.
 s.missions=[{...drone,id:'drone',scheduledDate:'2026-09-20',status:'PLANNED'},{...ground,id:'ground',scheduledDate:'2026-09-20',status:'PLANNED'},{...drone,id:'done',scheduledDate:'2026-09-20',status:'COMPLETED'}];
 expect(affectedByIncident(s,'WIND','2026-09-20')).toEqual({ids:['drone'],unchanged:['ground']});expect(affectedByIncident(s,'RAIN','2026-09-20').ids).toEqual(['drone','ground']);expect(affectedByIncident(s,'BREAKDOWN','2026-09-20','JB23TR01').ids).toEqual(['ground']);expect(affectedByIncident(s,'DROUGHT','2026-09-20').ids).toEqual([]);
});
