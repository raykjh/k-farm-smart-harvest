import type {Mission, State} from './types';
import {operatingCrewDemands} from './operating-capacity';
import {taskCrewStaff} from './planned-labor-demand';

/** Occupancy of one 15-minute slot. Field exclusivity is deliberately
 * conservative until a reviewed operation explicitly supports parallel work. */
export type ResourceUse = {
 field: string | null;
 resource: string | null;
 person: string | null;
 staff: number;
 transport: number;
 /** Optional qualified resource pools, e.g. each center's operators vs workers. */
 capacityDemands?: Record<string,number>;
};
export type ResourceCapacity = {staff: number; transport: number};
export type ResourceConflict = 'INVALID_CAPACITY'|'FIELD'|'EQUIPMENT'|'PERSON'|'STAFF'|'TRANSPORT';

export function missionResourceUse(state: State, mission: Pick<Mission,'fieldId'|'resourceId'|'owner'|'staff'|'transport'|'resourceOccupancyOnly'|'farmerWorkers'|'machineOperators'|'ordinaryWorkers'>, farmerId?:string): ResourceUse {
 // Foreign reservations block their equipment, not an invented common parcel
 // or the home center's crew. These projections never become executable tasks.
 if (mission.resourceOccupancyOnly) return {field:null,resource:mission.resourceId,person:null,staff:0,transport:0};
 return {
  field: mission.fieldId,
  resource: mission.resourceId,
  person: null,
  staff: taskCrewStaff(mission),
  transport: mission.transport,
  capacityDemands:operatingCrewDemands(state,mission),
 };
}

/** Shared by initial placement and independent verification of solver output.
 * No mutation, scheduling policy, loan authority or external inference here. */
export function slotResourceConflict(uses: ResourceUse[], capacity: ResourceCapacity): ResourceConflict | null {
 const valid = (n: number) => Number.isInteger(n) && n >= 0;
 if (!valid(capacity.staff) || !valid(capacity.transport) || uses.some(u => !valid(u.staff) || !valid(u.transport))) return 'INVALID_CAPACITY';
 for (const [key, reason] of [['field','FIELD'],['resource','EQUIPMENT'],['person','PERSON']] as const) {
  const ids = uses.map(u => u[key]).filter((id): id is string => !!id);
  if (new Set(ids).size !== ids.length) return reason;
 }
 if (uses.reduce((sum,u) => sum + u.staff,0) > capacity.staff) return 'STAFF';
 if (uses.reduce((sum,u) => sum + u.transport,0) > capacity.transport) return 'TRANSPORT';
 return null;
}
