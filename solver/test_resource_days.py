from solver.replanning import Task, Request, ResourceOption, replan
from solver.schedule_components import scheduling_components


def job(id, center, at, allowed=None, **kw):
    return Task(id=id, resource='machine', resourceDayCenter=center, original=at,
                allowed=allowed if allowed is not None else [at], duration=4,
                staff=0, transport=0, selected=True, **kw)


def solve(tasks):
    return replan(Request(tasks=tasks, purpose='INITIAL', freezeBefore=0,
                          staffCapacity=0, transportCapacity=0))


def test_same_center_can_reuse_a_machine_but_different_centers_cannot_share_a_day():
    a, b = job('a', 'A', 0), job('b', 'A', 4)
    assert len(solve([a, b])['assignments']) == 2
    b.resourceDayCenter = 'B'
    assert solve([a, b])['status'] == 'NO_FEASIBLE_PLAN'
    b.optional = True
    result = solve([a, b])
    assert result['resourceDayVersion'] == 'exclusive-center-days-v1'
    assert result['unassigned'] == ['b']


def test_lender_booking_stays_fixed_and_borrower_moves_to_a_different_day():
    a, b = job('a', 'A', 0, locked=True), job('b', 'B', 4, [4, 32], optional=True)
    result = solve([a, b])
    assert result['status'] == 'FEASIBLE'
    assert [(x['id'], x['start']) for x in result['assignments']] == [('a', 0), ('b', 32)]
    # Whole-day connectivity is essential even when actual shifts don't overlap.
    assert len(scheduling_components([a, b])) == 1


def test_missing_center_on_an_existing_appointment_cannot_bypass_exclusivity():
    assert solve([job('unknown', None, 0), job('borrower', 'B', 4)])['status'] == 'NO_FEASIBLE_PLAN'


def test_another_machine_or_date_does_not_create_a_false_conflict():
    a, b = job('a', 'A', 0), job('b', 'B', 32)
    assert len(solve([a, b])['assignments']) == 2
    b.original = 4
    b.options = [ResourceOption(resource='other', allowed=[4])]
    b.resource = 'other'
    assert len(solve([a, b])['assignments']) == 2


def test_optional_empty_candidates_do_not_claim_or_reserve_a_day():
    a, b = job('a', 'A', 0), job('b', 'B', 0, [], optional=True)
    result = solve([a, b])
    assert result['unassigned'] == ['b']
    assert [x['id'] for x in result['assignments']] == ['a']
