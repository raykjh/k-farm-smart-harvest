from main import solve, SolveRequest

def request(**kwargs):
    jobs=[dict(id=f'J{i}',resourceId=f'D{i%2}',start=0,duration=3,deadline=96,priority=8,batchKey=f'G{i//2}:rice:product') for i in range(10)]
    return SolveRequest(jobs=jobs, **kwargs)

def test_wind_and_shared_resources():
    result=solve(request(blockedUntil=32))
    assert result['status']=='FEASIBLE'
    assignments=result['assignments']
    assert len(assignments)==10
    for a in assignments:
        assert a['start']>=32
        assert a['start']+a['duration']<=96
        assert a['start']%32+a['duration']<=32
    for t in range(96):
        assert sum(a['start']<=t<a['start']+a['duration'] for a in assignments)<=1

def test_safety_and_staff():
    assert solve(request(unavailable=['D0']))['status']=='NO_FEASIBLE_PLAN'
    assert solve(request(staffCount=0))['status']=='NO_FEASIBLE_PLAN'

def test_exhausted_deadline():
    assert solve(request(blockedUntil=96))['status']=='NO_FEASIBLE_PLAN'

def test_batch_separates_incompatible_crop():
    r=request();r.jobs[1].resourceId='D0';r.jobs[1].batchKey='G0:pepper:product'
    result=solve(r)
    assert result['groups']==10

def test_ground_remains_while_drones_move_and_vehicle_is_reserved():
    r=request()
    for j in r.jobs: j.blockedWindows=[(0,32)]
    ground=dict(id='GROUND',resourceId='P1',start=0,duration=4,deadline=32,priority=9,batchKey='ground',fixedStart=0)
    from main import Job
    r.jobs.append(Job(**ground))
    result=solve(r)
    assert result['status']=='FEASIBLE'
    assert next(a for a in result['assignments'] if a['missionId']=='GROUND')['start']==0
    assert all(a['start']>=32 for a in result['assignments'] if a['missionId']!='GROUND')

def test_forbidden_window_does_not_block_entire_day():
    from main import Job
    r=SolveRequest(jobs=[Job(id='X',resourceId='D1',start=0,duration=3,deadline=32,priority=8,batchKey='X',blockedWindows=[(8,16)])])
    result=solve(r)
    assert result['assignments'][0]['start']==0
