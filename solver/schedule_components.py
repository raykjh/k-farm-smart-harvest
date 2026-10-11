"""Conservative connected components of the *same* scheduling contract.

Split only when neither resource constraints nor overlapping precedence can
cross the boundary. Forward, non-overlapping prerequisites remain DAG edges;
their presence is propagated by the caller. This is not row-count chunking.
"""
from heapq import heappush, heappop


def scheduling_components(tasks):
    parents = list(range(len(tasks)))

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    def join(a, b):
        a, b = root(a), root(b)
        if a != b:
            parents[max(a, b)] = min(a, b)

    spans, buckets, loan_pools = [], {}, {}
    ids = {t.id: i for i, t in enumerate(tasks)}
    edges = []

    def add_days(key, days, i):
        # Preserve gaps in actual availability. A machine usable in May and
        # September is not a shared candidate for all intervening dates.
        start = previous = None
        for day in sorted(days):
            if previous is not None and day != previous + 1:
                buckets.setdefault(key, []).append((start, previous + 1, i))
                start = None
            if start is None:
                start = day
            previous = day
        if start is not None:
            buckets.setdefault(key, []).append((start, previous + 1, i))

    for i, t in enumerate(tasks):
        options = [(o, o.resource, o.duration or t.duration, o.allowed) for o in t.options] if t.options is not None else [(None, t.resource, t.duration, t.allowed)]
        all_days, all_values = set(), set()
        for o, resource, duration, allowed in options:
            values = {s for s in allowed if s % 32 + duration <= 32}
            if t.locked:
                values = values.intersection({t.original}) if resource == t.resource and duration == t.duration else set()
            if not values:
                continue
            days = {s // 32 for s in values}
            all_days.update(days)
            all_values.update(values)
            if resource:
                add_days(('equipment', resource), days, i)
            if o is None:
                continue
            for p in o.operatorCandidates:
                add_days(('person', p.id), {s // 32 for s in values.intersection(p.allowed)}, i)
            for p in o.laborCandidates:
                add_days(('person', p.personId), {s // 32 for s in values.intersection(p.allowed)}, i)
            # The pool bounds distinct equipment across its claims. Keep all
            # reachable claims together even if the pool ID spans several days.
            for p in o.pools:
                if p.day not in days:
                    continue
                if p.id in loan_pools:
                    join(i, loan_pools[p.id])
                else:
                    loan_pools[p.id] = i
        values = all_values or {t.original}  # Empty tasks still have dependencies.
        spans.append((min(values) // 32, max(values) // 32 + 1))
        keys = set()
        if t.field:
            keys.add(('field', t.field))
        if t.person:
            keys.add(('person', t.person))
        if t.staff:
            keys.add(('global', 'staff'))
        if t.transport:
            keys.add(('global', 'transport'))
        for k, demand in t.capacityDemands.items():
            if demand:
                keys.add(('capacity', k))
        for key in keys:
            add_days(key, all_days, i)
        edges.extend((ids[p], i) for p in set(t.predecessors + ([t.predecessor] if t.predecessor else [])) if p in ids)

    for intervals in buckets.values():
        representative, end = None, None
        for lo, hi, i in sorted(intervals):
            if end is None or lo >= end:
                representative, end = i, hi
            else:
                join(i, representative)
                end = max(end, hi)

    for p, t in edges:
        # Otherwise one phase could choose a late prerequisite after its child.
        if spans[p][1] > spans[t][0]:
            join(p, t)

    # Resource connectivity can turn individually forward edges into a cycle
    # between components. Collapse SCCs instead of guessing a solve order.
    groups = {root(i) for i in range(len(tasks))}
    graph = {i: set() for i in groups}
    reverse = {i: set() for i in groups}
    for p, t in edges:
        a, b = root(p), root(t)
        if a != b:
            graph[a].add(b)
            reverse[b].add(a)
    visited, order = set(), []
    for i in sorted(groups):
        if i in visited:
            continue
        stack = [(i, False)]
        while stack:
            v, done = stack.pop()
            if done:
                order.append(v)
            elif v not in visited:
                visited.add(v)
                stack.append((v, True))
                stack.extend((w, False) for w in sorted(graph[v], reverse=True) if w not in visited)
    visited = set()
    for i in reversed(order):
        if i in visited:
            continue
        stack = [i]
        visited.add(i)
        while stack:
            v = stack.pop()
            join(i, v)
            for w in reverse[v]:
                if w not in visited:
                    visited.add(w)
                    stack.append(w)

    groups = {}
    for i in range(len(tasks)):
        groups.setdefault(root(i), []).append(i)
    graph = {i: set() for i in groups}
    degrees = {i: 0 for i in groups}
    for p, t in edges:
        a, b = root(p), root(t)
        if a != b and b not in graph[a]:
            graph[a].add(b)
            degrees[b] += 1
    keys = {g: min((spans[i][0], tasks[i].id) for i in indices) for g, indices in groups.items()}
    ready, components = [], []
    for g, degree in degrees.items():
        if not degree:
            heappush(ready, (keys[g], g))
    while ready:
        _, g = heappop(ready)
        components.append([tasks[i] for i in sorted(groups[g], key=lambda i: tasks[i].id)])
        for child in graph[g]:
            degrees[child] -= 1
            if not degrees[child]:
                heappush(ready, (keys[child], child))
    assert len(components) == len(groups), 'Unresolved component dependency cycle'
    return components
