import type {State,Mission,WindEvent} from './types';
// Explicit DEMO_ASSUMPTION thresholds, not manufacturer limits. Unknown fails closed.
export function windLimit(s:State,m:Mission){
 if(m.windLimitMs!==undefined)return m.windLimitMs;
 // Compatibility for already-saved v0.1 drone missions only.
 return s.machines.find(x=>x.id===m.resourceId)?.type==='방제드론'?5:null;
}
export function restricted(s:State,m:Mission,e:WindEvent){const limit=windLimit(s,m);return limit===null||e.windMs>=limit;}
export function weatherBlocked(s:State,m:Mission){return s.events.some(e=>restricted(s,m,e)&&m.start<e.end&&m.start+m.duration>e.start);}
