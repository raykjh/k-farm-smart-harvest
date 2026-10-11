from solver.replanning import Task, Request, replan

def job(id,original,allowed,selected=False,resource='M',staff=1,transport=1,preferred=None):
    return Task(id=id,original=original,allowed=allowed,duration=32,resource=resource,staff=staff,transport=transport,selected=selected,preferred=preferred)
def req(tasks,daily=False):return Request(tasks=tasks,freezeBefore=96,staffCapacity=2,transportCapacity=2,daily=daily)
def test_gap_preserves_existing():
    r=replan(req([job('a',0,[32,64],True,preferred=1),job('b',64,[64,96])]))
    assert r['phase']=='GAPS_ONLY'
    assert {a['id']:a['start'] for a in r['assignments']}=={'a':32,'b':64}
def test_legacy_frozen_contract_rebuilds_only_explicitly_movable_work():
    r=replan(req([job('a',0,[32,64,96],True,preferred=1),job('b',32,[32,128]),job('c',64,[64,128]),job('d',96,[96,128])],True))
    assert r['phase']=='REBUILD_RELATED'
    a={x['id']:x['start'] for x in r['assignments']}
    assert a=={'a':96,'b':32,'c':64,'d':128}
def test_preferred_day_beats_fallback_when_later_rebuild_can_fit():
    r=replan(req([job('a',0,[96,128],True,preferred=3),job('b',96,[96,160])]))
    assert r['phase']=='REBUILD_RELATED'
    assert next(x for x in r['assignments'] if x['id']=='a')['start']==96
def test_short_term_cannot_be_displaced():
    assert replan(req([job('a',0,[32],True),job('b',32,[32,128])]))['status']=='NO_FEASIBLE_PLAN'
def test_manual_work_does_not_require_vehicle():
    r=Request(tasks=[job('a',0,[32],True,None,1,0)],freezeBefore=96,staffCapacity=1,transportCapacity=0)
    assert replan(r)['status']=='FEASIBLE'

def test_preserve_then_explicit_expansion_can_displace_near_term_booking():
    tasks=[job('a',0,[32,96],True,preferred=1),job('b',32,[32,64])]
    first=replan(Request(tasks=tasks,freezeBefore=96,staffCapacity=2,transportCapacity=2,rebuildMode='PRESERVE',explicitPreferred=True))
    assert first['phase']=='GAPS_ONLY'
    assert next(x['start'] for x in first['assignments'] if x['id']=='a')==96
    second=replan(Request(tasks=tasks,freezeBefore=32,staffCapacity=2,transportCapacity=2,rebuildMode='EXPAND',explicitPreferred=True))
    assert second['phase']=='REBUILD_APPROVED'
    assert {x['id']:x['start'] for x in second['assignments']}=={'a':32,'b':64}

def test_batch_can_prefer_a_date_beyond_two_days_without_moving_others():
    r=replan(Request(tasks=[job('a',0,[128],True,preferred=4),job('b',0,[160],True,'N',preferred=4)],freezeBefore=96,staffCapacity=2,transportCapacity=2,daily=True,explicitPreferred=True,rebuildMode='PRESERVE'))
    assert r['phase']=='GAPS_ONLY'

def test_expansion_does_not_override_an_empty_weather_window():
    r=replan(Request(tasks=[job('a',0,[],True)],freezeBefore=32,staffCapacity=2,transportCapacity=2,rebuildMode='EXPAND'))
    assert r['status']=='NO_FEASIBLE_PLAN'

def test_gap_mode_can_use_entire_work_window_without_day_three_cutoff():
    r=replan(Request(tasks=[job('a',0,[224],True,preferred=1)],freezeBefore=32,staffCapacity=2,transportCapacity=2,daily=True,rebuildMode='PRESERVE'))
    assert r['phase']=='GAPS_ONLY'
    assert r['assignments'][0]['start']==224

def test_related_expansion_moves_tomorrow_but_never_unrelated_or_locked_tasks():
    a=job('a',0,[32],True,preferred=1);b=job('b',32,[32,64]);b.movable=True
    unrelated=job('c',96,[96,128]);unrelated.movable=False
    r=replan(Request(tasks=[a,b,unrelated],freezeBefore=0,staffCapacity=2,transportCapacity=2,rebuildMode='EXPAND'))
    assert {x['id']:x['start'] for x in r['assignments']}=={'a':32,'b':64,'c':96}
    b.locked=True
    assert replan(Request(tasks=[a,b],freezeBefore=0,staffCapacity=2,transportCapacity=2,rebuildMode='EXPAND'))['status']=='NO_FEASIBLE_PLAN'

def test_seven_day_outage_uses_different_daily_spares_before_moving_dates():
    from solver.replanning import ResourceOption
    tasks=[]
    for day in range(1,8):
        t=job(str(day),day*32,[],True,preferred=day)
        t.duration=4
        t.options=[ResourceOption(resource='local',allowed=[day*32+2] if day%2 else [],borrowed=False),ResourceOption(resource='neighbor',allowed=[day*32+2],borrowed=True),ResourceOption(resource='later',allowed=[9*32+day*4])]
        tasks.append(t)
    r=replan(Request(tasks=tasks,freezeBefore=0,staffCapacity=2,transportCapacity=2,rebuildMode='PRESERVE',daily=True))
    assert r['status']=='FEASIBLE'
    for a in r['assignments']:
        day=int(a['id']);assert a['start']//32==day
        assert a['resource']==('local' if day%2 else 'neighbor')

def test_lending_center_pool_cannot_promise_two_machines_with_one_operator_vehicle():
    from solver.replanning import ResourceOption, LoanPool
    tasks=[]
    for i in range(2):
        t=job(str(i),32+i*4,[],True,preferred=1);t.duration=4
        t.options=[ResourceOption(resource='spare'+str(i),allowed=[32+i*4],borrowed=True,pools=[LoanPool(day=1,id='neighbor-day1',capacity=1)])]
        tasks.append(t)
    request=Request(tasks=tasks,freezeBefore=0,staffCapacity=3,transportCapacity=3,rebuildMode='PRESERVE')
    assert replan(request)['status']=='NO_FEASIBLE_PLAN'
    # Two tasks on the same borrowed equipment consume one day-loan, not two.
    tasks[1].options[0].resource='spare0'
    assert replan(request)['status']=='FEASIBLE'

def test_same_field_different_equipment_cannot_overlap():
    a=Task(**{**job('a',0,[32],True,resource='TR').model_dump(),'field':'parcel-1'})
    b=Task(**{**job('b',32,[32,64],resource='DR').model_dump(),'field':'parcel-1'})
    b.movable=True
    request=Request(tasks=[a,b],freezeBefore=0,staffCapacity=4,transportCapacity=4,rebuildMode='PRESERVE')
    assert replan(request)['status']=='NO_FEASIBLE_PLAN'
    request.rebuildMode='EXPAND'
    result=replan(request)
    assert {x['id']:x['start'] for x in result['assignments']}=={'a':32,'b':64}
    b.locked=True
    assert replan(request)['status']=='NO_FEASIBLE_PLAN'

def test_different_fields_can_still_run_in_parallel():
    a=Task(**{**job('a',0,[32],True,resource='TR').model_dump(),'field':'parcel-1'})
    b=Task(**{**job('b',32,[32],resource='DR').model_dump(),'field':'parcel-2'})
    result=replan(Request(tasks=[a,b],freezeBefore=0,staffCapacity=2,transportCapacity=2,rebuildMode='PRESERVE'))
    assert result['status']=='FEASIBLE'
    assert [x['start'] for x in result['assignments']]==[32,32]

def test_initial_admission_solves_flexible_and_tight_windows_together():
    a=job('flexible',32,[32,64],True);a.optional=True
    b=job('tight',32,[32],True);b.optional=True
    request=Request(tasks=[a,b],freezeBefore=32,staffCapacity=1,transportCapacity=1,purpose='INITIAL')
    r=replan(request)
    assert r['contractVersion']=='shared-schedule-v1'
    assert r['phase']=='INITIAL_DISPATCH'
    assert {x['id']:x['start'] for x in r['assignments']}=={'flexible':64,'tight':32}
    # Replanning still requires the whole supplied task set, never silently drops.
    request.purpose='REPLAN';a.allowed=[32];request.rebuildMode='PRESERVE'
    assert replan(request)['status']=='NO_FEASIBLE_PLAN'

def test_initial_option_duration_is_not_inherited_from_first_equipment():
    from solver.replanning import ResourceOption
    a=job('new',32,[32],True,resource='slow');a.optional=True
    a.options=[ResourceOption(resource='slow',allowed=[32],duration=32),ResourceOption(resource='fast',allowed=[32],duration=16)]
    request=Request(tasks=[a],freezeBefore=32,staffCapacity=1,transportCapacity=1,purpose='INITIAL')
    result=replan(request)
    assert result['assignments']==[{'id':'new','start':32,'resource':'fast','duration':16}]

def test_partial_initial_plan_requires_its_predecessor_and_never_drops_fixed_work():
    a=job('before',32,[32],True);a.optional=True
    b=job('after',32,[32],True);b.optional=True;b.predecessors=['before']
    request=Request(tasks=[b,a],freezeBefore=32,staffCapacity=1,transportCapacity=1,purpose='INITIAL')
    r=replan(request)
    assert [x['id'] for x in r['assignments']]==['before']
    assert r['unassigned']==['after']
    fixed=job('fixed',32,[32]);fixed.locked=True;fixed.optional=True
    request.tasks.append(fixed)
    r=replan(request)
    assert [x['id'] for x in r['assignments']]==['fixed']
def test_qualified_center_pools_do_not_share_operators_or_hide_absence():
    tasks = [Task(id='a', original=32, duration=4, allowed=[32], selected=True,
                  optional=True, staff=0, transport=0,
                  capacityDemands={'local:operators': 1}),
             Task(id='b', original=32, duration=4, allowed=[32], selected=True,
                  optional=True, staff=0, transport=0,
                  capacityDemands={'local:operators': 1})]
    req = Request(tasks=tasks, purpose='INITIAL', freezeBefore=0,
                  staffCapacity=0, transportCapacity=0,
                  capacityLimits={'local:operators': 1, 'foreign:operators': 10})
    out = replan(req)
    assert out['capacityPoolsVersion'] == 'qualified-pools-v1'
    assert len(out['assignments']) == 1
    req.capacityLimits['local:operators'] = 0
    assert len(replan(req)['assignments']) == 0

