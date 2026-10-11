from solver.replanning import Task, ResourceOption, LoanPool, OperatorCandidate, LaborCandidate
from solver.schedule_components import scheduling_components


def job(id, at=0, **kwargs):
    return Task(id=id, original=at, duration=4, allowed=[at], staff=0, transport=0, **kwargs)


def components(tasks):
    return [set(t.id for t in c) for c in scheduling_components(tasks)]


def test_separates_disjoint_qualified_pools_even_on_the_same_day():
    a = job('a', capacityDemands={'A:workers': 1, 'unused': 0})
    b = job('b', capacityDemands={'B:workers': 1, 'unused': 0})
    assert components([a, b]) == [{'a'}, {'b'}]
    b.capacityDemands['A:workers'] = 1
    assert components([a, b]) == [{'a', 'b'}]


def test_every_equipment_alternative_and_locked_occupancy_stays_connected():
    a = job('a', options=[ResourceOption(resource='own', allowed=[0]), ResourceOption(resource='shared', allowed=[32])])
    b = job('b', 32, resource='shared', locked=True)
    assert components([a, b]) == [{'a', 'b'}]


def test_uses_each_resource_window_not_the_task_envelope_or_original_date():
    a = job('a', 0, options=[ResourceOption(resource='own-A', allowed=[0, 320]), ResourceOption(resource='loan', allowed=[320])])
    b = job('b', 0, options=[ResourceOption(resource='loan', allowed=[160])])
    assert components([a, b]) == [{'a'}, {'b'}]
    b.options[0].allowed = [320]
    assert components([a, b]) == [{'a', 'b'}]


def test_empty_or_out_of_shift_options_do_not_connect_equipment_people_or_pools():
    unreachable = ResourceOption(resource='loan', allowed=[31], duration=4,
        operatorCandidates=[OperatorCandidate(id='operator', allowed=[0])],
        laborCandidates=[LaborCandidate(id='window', personId='helper', allowed=[0])],
        pools=[LoanPool(id='pool', day=0, capacity=1)])
    a = job('a', options=[ResourceOption(resource='own', allowed=[0]), unreachable])
    b = job('b', options=[ResourceOption(resource='loan', allowed=[0],
        operatorCandidates=unreachable.operatorCandidates, laborCandidates=unreachable.laborCandidates, pools=unreachable.pools)])
    assert components([a, b]) == [{'a'}, {'b'}]


def test_people_and_pool_claims_only_connect_when_the_option_can_reach_them():
    a = job('a', options=[ResourceOption(allowed=[0],
        operatorCandidates=[OperatorCandidate(id='operator', allowed=[64])],
        laborCandidates=[LaborCandidate(id='window', personId='helper', allowed=[64])],
        pools=[LoanPool(id='pool', day=2, capacity=1)])])
    for candidate in [job('b', 64, person='operator'), job('b', 64, person='helper'),
                      job('b', 64, options=[ResourceOption(resource='loan', allowed=[64], pools=[LoanPool(id='pool', day=2, capacity=1)])])]:
        assert components([a, candidate]) == [{'a'}, {'b'}]


def test_locked_task_does_not_claim_unused_alternative_days_but_keeps_its_real_day():
    a = job('a', 0, locked=True, resource='own', options=[ResourceOption(resource='own', allowed=[0, 64]), ResourceOption(resource='loan', allowed=[0, 64])])
    assert components([a, job('b', 64, resource='own')]) == [{'a'}, {'b'}]
    assert components([a, job('b', 0, resource='loan')]) == [{'a'}, {'b'}]
    assert components([a, job('b', 0, resource='own')]) == [{'a', 'b'}]


def test_gap_in_calendar_does_not_claim_global_capacity_on_a_day_without_candidates():
    a = job('a', capacityDemands={'workers': 1}, options=[ResourceOption(allowed=[0, 64])])
    b = job('b', 32, capacityDemands={'workers': 1})
    assert components([a, b]) == [{'a'}, {'b'}]
    b.allowed = [64]
    assert components([a, b]) == [{'a', 'b'}]


def test_shared_people_include_named_operators_and_labor_support():
    a = job('a', options=[ResourceOption(allowed=[0], operatorCandidates=[OperatorCandidate(id='person', allowed=[0])])])
    b = job('b', options=[ResourceOption(allowed=[0], laborCandidates=[LaborCandidate(id='support', personId='person', allowed=[0])])])
    assert components([a, b]) == [{'a', 'b'}]
    assert components([a, job('c', person='person')]) == [{'a', 'c'}]


def test_global_staff_transport_and_same_parcel_prevent_false_independence():
    for attribute, value in [('staff', 1), ('transport', 1), ('field', 'same')]:
        a, b = job('a'), job('b')
        setattr(a, attribute, value)
        setattr(b, attribute, value)
        assert components([a, b]) == [{'a', 'b'}]


def test_loan_pool_stays_together_even_when_shifts_or_dates_do_not_overlap():
    a = job('a', options=[ResourceOption(resource='one', allowed=[0], pools=[LoanPool(id='shared', day=0, capacity=1)])])
    b = job('b', 64, options=[ResourceOption(resource='two', allowed=[64], pools=[LoanPool(id='shared', day=2, capacity=1)])])
    assert components([a, b]) == [{'a', 'b'}]


def test_overlapping_or_backwards_precedence_cannot_cross_phases():
    assert components([job('after', predecessors=['before']), job('before')]) == [{'before', 'after'}]
    assert components([job('after', predecessors=['before']), job('before', 64)]) == [{'before', 'after'}]
    assert components([job('after', 64, predecessors=['before']), job('before')]) == [{'before'}, {'after'}]


def test_collapses_component_cycles_created_by_shared_resources():
    # A spans early and late periods; B is between them. Each dependency alone
    # is forward, but solving A before B would silently lose B -> A-late.
    a = job('a', options=[ResourceOption(resource='one', allowed=[0], pools=[LoanPool(id='cycle-pool', day=0, capacity=2)])])
    b = job('b', 64, predecessors=['a'])
    c = job('c', 128, predecessors=['b'], options=[ResourceOption(resource='two', allowed=[128], pools=[LoanPool(id='cycle-pool', day=4, capacity=2)])])
    assert components([c, a, b]) == [{'a', 'b', 'c'}]


def test_topological_order_is_independent_of_input_order_and_handles_long_chains():
    tasks = [job(str(i), i*32, predecessors=[str(i-1)] if i else []) for i in range(1500)]
    assert components(tasks) == components(list(reversed(tasks)))


def test_timeout_discards_completed_components_instead_of_returning_a_partial_plan(monkeypatch):
    from solver import replanning
    clock = [0]
    monkeypatch.setattr(replanning, 'monotonic', lambda: clock[0])

    def slow_solve(req, deadline, budget):
        clock[0] = 31
        return {'status': 'FEASIBLE', 'phase': 'INITIAL_DISPATCH', 'assignments': [{'id': req.tasks[0].id, 'start': 0}], 'optimal': True}

    monkeypatch.setattr(replanning, '_replan', slow_solve)
    request = replanning.Request(tasks=[job(str(i), i*32, optional=True) for i in range(601)], purpose='INITIAL', freezeBefore=0, staffCapacity=0, transportCapacity=0)
    result = replanning.replan(request)
    assert result['status'] == 'NO_FEASIBLE_PLAN'
    assert result['components'] == 601
    assert 'assignments' not in result


def test_many_small_fixed_groups_do_not_starve_the_remaining_congestion_group(monkeypatch):
    from solver import replanning
    tasks = [job(str(i), i*32, optional=True) for i in range(700)]
    monkeypatch.setattr(replanning, 'scheduling_components', lambda _: [tasks[:289]] + [[t] for t in tasks[289:]])
    monkeypatch.setattr(replanning, 'monotonic', lambda: 0)
    budgets = []

    def inspect_budget(req, deadline, budget):
        budgets.append(budget)
        return {'status': 'FEASIBLE', 'phase': 'INITIAL_DISPATCH', 'assignments': [], 'optimal': False}

    monkeypatch.setattr(replanning, '_replan', inspect_budget)
    req = replanning.Request(tasks=tasks, purpose='INITIAL', freezeBefore=0, staffCapacity=0, transportCapacity=0)
    result = replanning.replan(req)
    assert result['status'] == 'FEASIBLE'
    assert budgets[0] == 5
    assert all(0 < budget <= 5 for budget in budgets)
