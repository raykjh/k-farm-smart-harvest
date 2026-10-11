from solver.replanning import Task, Request, ResourceOption, LaborCandidate, CapacityBlock, replan


def labor_job(id='harvest', starts=None):
    starts = starts or [34]
    return Task(id=id, original=34, duration=4, allowed=starts, selected=True,
                optional=True, staff=1, transport=0, ordinaryWorkerCount=1,
                workerPool='receiver:workers', capacityDemands={'receiver:workers': 1},
                options=[ResourceOption(allowed=starts, laborCandidates=[
                    LaborCandidate(id='window', personId='owner:worker', allowed=starts)])])


def request(tasks, purpose='INITIAL', staff=0):
    return Request(tasks=tasks, purpose=purpose, freezeBefore=0, rebuildMode='PRESERVE',
                   staffCapacity=staff, transportCapacity=0,
                   capacityLimits={'receiver:workers': staff})


def test_confirmed_capacity_is_used_by_both_initial_and_replanning():
    for purpose in ['INITIAL', 'REPLAN']:
        result = replan(request([labor_job()], purpose))
        assert result['status'] == 'FEASIBLE'
        assert result['laborCapacityVersion'] == 'confirmed-labor-v1'
        assert result['assignments'][0]['laborSupportIds'] == ['window']


def test_local_workers_precede_borrowed_capacity_when_both_fit():
    assert replan(request([labor_job()], staff=1))['assignments'][0]['laborSupportIds'] == []


def test_support_cannot_replace_an_operator_or_work_outside_confirmed_times():
    job = labor_job(); job.ordinaryWorkerCount = 0
    assert not replan(request([job]))['assignments']
    job = labor_job(); job.options[0].laborCandidates[0].allowed = [40]
    assert not replan(request([job]))['assignments']


def test_one_person_never_works_twice_at_once_even_with_two_window_ids():
    a, b = labor_job('a'), labor_job('b')
    b.options[0].laborCandidates[0].id = 'another-window'
    assert len(replan(request([a, b]))['assignments']) == 1


def test_locked_support_is_preserved_and_rejected_if_window_is_no_longer_valid():
    job = labor_job(); job.locked = True; job.laborSupportIds = ['window']
    assert replan(request([job], staff=1))['assignments'][0]['laborSupportIds'] == ['window']
    job.options[0].laborCandidates[0].allowed = [40]
    assert replan(request([job], staff=1))['status'] == 'NO_FEASIBLE_PLAN'


def test_owner_capacity_is_removed_for_full_travel_and_work_window():
    job = labor_job(starts=[32, 40]); job.options[0].laborCandidates = []
    req = request([job], staff=1)
    req.capacityBlocks = [CapacityBlock(start=32, duration=8, staff=1,
                                       capacityDemands={'receiver:workers': 1})]
    assert replan(req)['assignments'][0]['start'] == 40
    req.capacityBlocks.append(req.capacityBlocks[0])
    assert replan(req)['status'] == 'NO_FEASIBLE_PLAN'
