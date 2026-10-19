"""Bounded, deterministic warm starts for the existing CP-SAT model.

These are search hints, NEVER executable assignments or an infeasibility proof.
The full model (and the server's independent verifier) remains authoritative.
Keeping this separate from the result path prevents a heuristic from bypassing
weather windows, individual qualifications, loan agreements or hard capacity.
"""
from collections import defaultdict
from dataclasses import dataclass
from time import monotonic


@dataclass(frozen=True)
class PlacementHint:
    start: int
    option: int
    duration: int


def placement_hints(req, valid_options, movable_ids, deadline):
    """Freeze commitments, then place urgent selected work before flexible work.

    All choices come from already-filtered model domains. If the greedy order
    gets stuck or its small time budget ends, CP-SAT receives only partial hints
    and can change them freely. No request task is dropped or window widened.
    """
    # Avoid materializing huge hint candidate arrays for broad multi-year
    # contracts; the authoritative solver can still process those domains.
    if monotonic() >= deadline or sum(len(allowed) for options in valid_options.values() for _, allowed in options) > 2000000:
        return {}
    tasks = {t.id: t for t in req.tasks}
    predecessors = {t.id: set(t.predecessors + ([t.predecessor] if t.predecessor else [])).intersection(tasks) for t in req.tasks}
    successors = defaultdict(set)
    for id, priors in predecessors.items():
        for prior in priors:
            successors[prior].add(id)
    occupied = defaultdict(set)
    staff, transport, pools = defaultdict(int), defaultdict(int), defaultdict(lambda: defaultdict(int))
    for block in req.capacityBlocks:
        if monotonic() >= deadline:
            return {}
        for slot in range(block.start, block.start + block.duration):
            staff[slot] += block.staff
            for pool, demand in block.capacityDemands.items():
                pools[slot][pool] += demand
    loan_limits, loan_claims, equipment_days = {}, defaultdict(set), {}
    exclusive = {o.resource for t in req.tasks if t.resourceDayCenter for o, _ in valid_options[t.id] if o.resource}
    for options in valid_options.values():
        if monotonic() >= deadline:
            return {}
        for option, _ in options:
            for pool in option.pools:
                loan_limits[pool.id] = min(loan_limits.get(pool.id, pool.capacity), pool.capacity)
    hints = {}

    def place(task, option_index, start):
        option, _ = valid_options[task.id][option_index]
        duration = option.duration if option.duration is not None else task.duration
        end, day = start + duration, start // 32
        slots = range(start, end)
        if any(start < hints[p].start + hints[p].duration for p in predecessors[task.id] if p in hints):
            return False
        if any(end > hints[p].start for p in successors[task.id] if p in hints):
            return False
        keys = {('field', task.field)} if task.field else set()
        if option.resource:
            keys.add(('equipment', option.resource))
        if task.person:
            keys.add(('person', task.person))
        if any(keys.intersection(occupied[s]) for s in slots):
            return False
        if option.resource in exclusive and (option.resource, day) in equipment_days and equipment_days[(option.resource, day)] != task.resourceDayCenter:
            return False
        claims = [p for p in option.pools if p.day == day and option.resource]
        if any(len(loan_claims[p.id] | {option.resource}) > loan_limits[p.id] for p in claims):
            return False

        # Pick available people only to make useful hints; the model still owns
        # the actual named-person decision and all qualification checks.
        def free_person(id):
            key = ('person', id)
            return key not in keys and all(key not in occupied[s] for s in slots)

        fixed = task.id not in movable_ids
        if task.operatorCount is not None:
            candidates = sorted({p.id for p in option.operatorCandidates if start in p.allowed and free_person(p.id)})
            ids = task.operatorIds if fixed and task.operatorIds is not None else candidates[:task.operatorCount]
            if len(set(ids)) != task.operatorCount or not set(ids).issubset(candidates):
                return False
            keys.update(('person', id) for id in ids)
        required_support = max([0] + [staff[s] + task.staff - req.staffCapacity for s in slots])
        if task.workerPool:
            required_support = max(required_support, max(pools[s][task.workerPool] + task.capacityDemands.get(task.workerPool, 0) - req.capacityLimits.get(task.workerPool, -1) for s in slots))
        support_count = len(task.laborSupportIds) if fixed else required_support
        if support_count < required_support or support_count > min(task.ordinaryWorkerCount, task.staff):
            return False
        candidates = sorted(option.laborCandidates, key=lambda p: p.id)
        chosen = []
        for person in candidates:
            if len(chosen) == support_count:
                break
            if fixed and person.id not in task.laborSupportIds:
                continue
            if start in person.allowed and free_person(person.personId):
                keys.add(('person', person.personId))
                chosen.append(person.id)
        if len(chosen) != support_count or fixed and set(chosen) != set(task.laborSupportIds):
            return False
        demands = dict(task.capacityDemands)
        if task.workerPool:
            demands[task.workerPool] = demands.get(task.workerPool, 0) - support_count
        if any(value < 0 or pool not in req.capacityLimits for pool, value in demands.items()):
            return False
        if any(staff[s] + task.staff - support_count > req.staffCapacity or transport[s] + task.transport > req.transportCapacity or any(pools[s][pool] + demand > req.capacityLimits[pool] for pool, demand in demands.items()) for s in slots):
            return False
        for s in slots:
            occupied[s].update(keys)
            staff[s] += task.staff - support_count
            transport[s] += task.transport
            for pool, demand in demands.items():
                pools[s][pool] += demand
        for pool in claims:
            loan_claims[pool.id].add(option.resource)
        if option.resource in exclusive:
            equipment_days[(option.resource, day)] = task.resourceDayCenter
        hints[task.id] = PlacementHint(start, option_index, duration)
        return True

    # Existing bookings consume capacity before any requested changes. The
    # caller already removed disallowed fixed-resource/variable-duration options.
    for task in req.tasks:
        if monotonic() >= deadline:
            return hints
        if task.id not in movable_ids and not any(place(task, j, task.original) for j in range(len(valid_options[task.id]))):
            return {}  # Invalid fixed commitments cannot seed a useful plan.

    def urgency(task):
        dates = {s // 32 for _, allowed in valid_options[task.id] for s in allowed}
        return (not task.selected, len(dates), max(dates, default=0), task.original, task.id)

    pending = sorted((t for t in req.tasks if t.id in movable_ids), key=urgency)
    while pending and monotonic() < deadline:
        ready = next((t for t in pending if predecessors[t.id].issubset(hints)), None)
        if ready is None:
            break
        pending.remove(ready)
        target = ready.preferred if ready.preferred is not None else ready.original // 32
        choices = []
        for j, (option, allowed) in enumerate(valid_options[ready.id]):
            if monotonic() >= deadline or len(choices) + len(allowed) > 100000:
                return hints
            resource_cost = (100000 if option.borrowed else 0) + (1000 if option.resource != ready.resource else 0)
            for start in allowed:
                date_cost = abs(start // 32 - target) if ready.selected else 0
                change_cost = (1000000 if start != ready.original else 0) if not ready.selected else 0
                choices.append((date_cost, change_cost + resource_cost + abs(start - ready.original), start, j))
        for _, _, start, j in sorted(choices):
            if monotonic() >= deadline:
                return hints
            if place(ready, j, start):
                break
    return hints
