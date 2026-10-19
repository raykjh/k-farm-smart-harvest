from time import monotonic
from solver.schedule_hints import placement_hints
from solver.replanning import Task, ResourceOption, Request, _replan, replan


def task(id, starts, **kwargs):
    return Task(id=id, original=32, duration=1, allowed=starts, selected=True,
                preferred=1, staff=1, transport=0, **kwargs)


def request(tasks):
    return Request(tasks=tasks, freezeBefore=0, staffCapacity=2,
                   transportCapacity=1, rebuildMode='EXPAND')


def test_expired_hint_budget_returns_nothing_and_does_not_change_input():
    req = request([task('one', [32])])
    before = req.model_dump()
    options = {'one': [(ResourceOption(allowed=[32]), [32])]}
    assert placement_hints(req, options, {'one'}, monotonic()-1) == {}
    assert req.model_dump() == before


def test_cyclic_or_unplaceable_hint_is_not_a_partial_executable_plan():
    a = task('a', [32], predecessor='b')
    b = task('b', [32], predecessor='a')
    req = request([a, b])
    out = replan(req)
    assert out['status'] == 'NO_FEASIBLE_PLAN'
    assert out['failureKind'] == 'INFEASIBLE'
    assert 'assignments' not in out


def test_unknown_search_is_not_reported_as_proven_resource_shortage(monkeypatch):
    from solver import replanning
    def timed_out(req, expand, time_limit, diagnostics):
        diagnostics['failureKind'] = 'TIME_LIMIT'
        return None
    monkeypatch.setattr(replanning, 'attempt', timed_out)
    result = _replan(request([task('one', [32])]))
    assert result['failureKind'] == 'TIME_LIMIT'
    assert '가능한 배치가 없다는 뜻은 아니며' in result['reason']
    assert 'assignments' not in result


def test_invalid_cp_model_is_not_reported_as_proven_resource_shortage(monkeypatch):
    from solver import replanning
    def invalid(req, expand, time_limit, diagnostics):
        diagnostics['failureKind'] = 'INVALID'
        return None
    monkeypatch.setattr(replanning, 'attempt', invalid)
    assert _replan(request([task('one', [32])]))['failureKind'] == 'INVALID'


def test_malicious_or_stale_hints_cannot_move_locked_work_or_bypass_constraints(monkeypatch):
    from solver import replanning
    from solver.schedule_hints import PlacementHint
    a = task('a', [32], resource='M')
    b = task('b', [32, 64], resource='M', locked=True)
    # Hints are NOT returned as a fallback, even if they assert a fake vacancy.
    monkeypatch.setattr(replanning, 'placement_hints', lambda *args: {'a': PlacementHint(32, 0, 1), 'b': PlacementHint(64, 0, 1)})
    result = replan(request([a, b]))
    assert result['status'] == 'NO_FEASIBLE_PLAN'
    assert result['failureKind'] == 'INFEASIBLE'


def test_partial_hint_can_be_overridden_to_place_flexible_work_after_tight_work(monkeypatch):
    from solver import replanning
    from solver.schedule_hints import PlacementHint
    a = task('a', [32, 33], resource='M')
    b = task('b', [32], resource='M')
    monkeypatch.setattr(replanning, 'placement_hints', lambda *args: {'a': PlacementHint(32, 0, 1)})
    result = replan(request([a, b]))
    assert result['status'] == 'FEASIBLE'
    assert {a['id']: a['start'] for a in result['assignments']} == {'a': 33, 'b': 32}
