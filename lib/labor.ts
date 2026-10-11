export type LaborCandidate = {
  id: string; name: string; score: number; distanceKm: number | null;
  recentAssignments: number; eligible: boolean; response: 'NONE' | 'APP' | 'PHONE';
};
// Eligibility and voluntary response precede ranking. Unknown distance sorts last.
export function rankLabor(candidates: LaborCandidate[]) {
  return candidates.filter(c => c.eligible && c.response !== 'NONE').sort((a,b) =>
    b.score-a.score || (a.distanceKm ?? Infinity)-(b.distanceKm ?? Infinity) ||
    a.recentAssignments-b.recentAssignments || a.id.localeCompare(b.id));
}
export function allocateLabor(candidates: LaborCandidate[], capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid capacity');
  const ranked = rankLabor(candidates);
  return {selected: ranked.slice(0,capacity), waiting: ranked.slice(capacity), shortage: Math.max(0,capacity-ranked.length)};
}
