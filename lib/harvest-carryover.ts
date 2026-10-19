import type {Mission,State} from './types';
import type {ReplanInput} from './annual-replanning';
import {immovable} from './replan-scope';

export type HarvestCarryover={policy:'NEXT_DAY_HARVEST_V1';originalFrom:string;originalTo:string;previousDate:string;date:string;requestedOn:string};
const nextDay=(day:string)=>new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);

/** A missed harvest remains necessary after its target window. Carry only the
 * selected, unstarted harvest to the next day; preserve the source window for
 * audit. This is an operational recovery policy, not an agronomic guarantee.
 * Planting, pesticide intervals, growth checks and weather limits stay intact. */
export function withHarvestCarryover(state:State,input:ReplanInput,asOf:string):State{
 if(input.outage)return state;
 return {...state,missions:state.missions.map(m=>{
  const window=m.planningWindow,operation=(m as Mission&{operationCode?:string}).operationCode;
  if(!input.ids.includes(m.id)||immovable(m)||operation!=='harvest'||!window||!m.scheduledDate||m.scheduledDate>asOf)return m;
  const date=nextDay([asOf,input.deferAfter??asOf].sort().at(-1)!);
  if(window.to>=date||input.preferred&&input.preferred!==date)return m;
  const original=m.harvestCarryover;
  return {...m,harvestCarryover:{policy:'NEXT_DAY_HARVEST_V1' as const,originalFrom:original?.originalFrom??window.from,originalTo:original?.originalTo??window.to,previousDate:m.scheduledDate,date,requestedOn:asOf},planningWindow:{...window,from:date,to:date}};
 })};
}
