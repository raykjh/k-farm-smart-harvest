from pydantic import BaseModel, Field
from ortools.sat.python import cp_model
from typing import Literal
from time import monotonic
from .schedule_components import scheduling_components

CONTRACT_VERSION = 'shared-schedule-v1'

class LoanPool(BaseModel):
    day: int
    id: str
    capacity: int = Field(ge=0)

class OperatorCandidate(BaseModel):
    id: str
    allowed: list[int] = Field(max_length=24000)

class LaborCandidate(OperatorCandidate):
    personId: str

class CapacityBlock(BaseModel):
    start: int
    duration: int = Field(ge=1, le=32)
    staff: int = Field(ge=0, le=1000)
    capacityDemands: dict[str, int] = Field(default_factory=dict)

class ResourceOption(BaseModel):
    resource: str | None = None
    allowed: list[int] = Field(max_length=24000)
    borrowed: bool = False
    offerId: str | None = None
    pools: list[LoanPool] = Field(default_factory=list)
    duration: int | None = Field(default=None, ge=1, le=32)
    operatorCandidates: list[OperatorCandidate] = Field(default_factory=list, max_length=100)
    laborCandidates: list[LaborCandidate] = Field(default_factory=list, max_length=100)

class Task(BaseModel):
    id: str
    original: int
    duration: int = Field(ge=1,le=32)
    allowed: list[int] = Field(max_length=24000)
    resource: str | None = None
    options: list[ResourceOption] | None = None
    field: str | None = None
    movable: bool | None = None
    locked: bool = False
    staff: int = Field(ge=0,le=50)
    transport: int = Field(ge=0,le=10)
    person: str | None = None
    predecessor: str | None = None
    predecessors: list[str] = Field(default_factory=list)
    selected: bool = False
    preferred: int | None = None
    optional: bool = False
    required: bool = True
    capacityDemands: dict[str, int] = Field(default_factory=dict)
    operatorCount: int | None = Field(default=None, ge=0, le=50)
    operatorIds: list[str] | None = None
    ordinaryWorkerCount: int = Field(default=0, ge=0, le=50)
    laborSupportIds: list[str] = Field(default_factory=list)
    workerPool: str | None = None
    resourceDayCenter: str | None = Field(default=None, min_length=1, max_length=100)

class Request(BaseModel):
    tasks: list[Task] = Field(max_length=5000)
    freezeBefore: int
    staffCapacity: int = Field(ge=0,le=1000)
    transportCapacity: int = Field(ge=0,le=1000)
    daily: bool = False
    rebuildMode: str = 'AUTO'
    explicitPreferred: bool = False
    purpose: Literal['INITIAL', 'REPLAN'] = 'REPLAN'
    capacityLimits: dict[str, int] = Field(default_factory=dict)
    capacityBlocks: list[CapacityBlock] = Field(default_factory=list, max_length=2000)

def attempt(req: Request, expand: bool, time_limit: float = 5):
    model=cp_model.CpModel(); starts={}; ends={}; intervals=[]; resources={}; people={}; fields={}; costs=[]; selections={}; loan_claims={}; pool_caps={}; presence={}; durations={}
    initial=req.purpose=='INITIAL'
    operator_selections={};labor_selections={};local_staff={};local_workers={}
    # Exclusive equipment-days match the operational cross-center loan policy.
    # Only days with multiple possible centers need additional constraints.
    exclusive={o.resource for t in req.tasks if t.resourceDayCenter for o in (t.options if t.options is not None else [ResourceOption(resource=t.resource,allowed=t.allowed)]) if o.resource}
    resource_day_centers={};resource_day_claims={}
    for t in req.tasks:
        for o in (t.options if t.options is not None else [ResourceOption(resource=t.resource,allowed=t.allowed)]):
            if o.resource not in exclusive:continue
            duration=o.duration if o.duration is not None else t.duration
            for day in {s//32 for s in o.allowed if s%32+duration<=32}:
                resource_day_centers.setdefault((o.resource,day),set()).add(t.resourceDayCenter)
    initial_bound=1+sum(5101000+max([abs(s-t.original) for o in (t.options or [ResourceOption(resource=t.resource,allowed=t.allowed)]) for s in o.allowed]+[0])+32 for t in req.tasks)
    # One day of selected-task deviation outranks the entire lower-tier cost,
    # rather than relying on a weight that breaks on a large task set.
    date_weight=1+sum(7101000+max([abs(s-t.original) for o in (t.options or [ResourceOption(resource=t.resource,allowed=t.allowed)]) for s in o.allowed]+[0]) for t in req.tasks)
    for i,t in enumerate(req.tasks):
        optional=initial and t.optional and not t.locked
        movable=optional if initial else not t.locked and (t.selected or (expand and (t.movable if t.movable is not None else t.original>=req.freezeBefore)))
        options=t.options if t.options is not None else [ResourceOption(resource=t.resource,allowed=t.allowed)]
        valid=[]
        for o in options:
            duration=o.duration if o.duration is not None else t.duration
            allowed=[s for s in o.allowed if s%32+duration<=32] if movable else ([t.original] if o.resource==t.resource and t.original in o.allowed and duration==t.duration else [])
            if allowed: valid.append((o,allowed))
        if not valid and not optional:return None
        values=sorted(set(s for _,allowed in valid for s in allowed)) or [t.original]
        start=model.new_int_var_from_domain(cp_model.Domain.from_values(values),f's{i}')
        present=model.new_bool_var(f'present{i}')
        if not optional:model.add(present==1)
        elif initial:model.add_hint(present,1)
        presence[t.id]=present
        duration=model.new_int_var(1,32,f'duration{i}')
        durations[t.id]=duration
        end=model.new_int_var(min(values)+1,max(values)+32,f'e{i}')
        interval=model.new_optional_interval_var(start,duration,end,present,f'i{i}')
        # Absent tasks never occupy resources, and have a deterministic dummy value.
        model.add(start==min(values)).only_enforce_if(present.Not())
        model.add(duration==t.duration).only_enforce_if(present.Not())
        starts[t.id]=start;ends[t.id]=end;intervals.append(interval)
        selections[t.id]=[]
        operator_selections[t.id]=[]
        labor_selections[t.id]=[]
        for j,(o,allowed) in enumerate(valid):
            chosen=model.new_bool_var(f'choose{i}_{j}')
            model.add_linear_expression_in_domain(start,cp_model.Domain.from_values(allowed)).only_enforce_if(chosen)
            option_duration=o.duration if o.duration is not None else t.duration
            model.add(duration==option_duration).only_enforce_if(chosen)
            resource_interval=model.new_optional_interval_var(start,option_duration,end,chosen,f'r{i}_{j}')
            if o.resource:resources.setdefault(o.resource,[]).append(resource_interval)
            selections[t.id].append((o,chosen))
            if t.operatorCount is not None:
                op_choices=[]
                if len({p.id for p in o.operatorCandidates})!=len(o.operatorCandidates):return None
                for n,p in enumerate(o.operatorCandidates):
                    operator_values=sorted(set(p.allowed).intersection(allowed))
                    if not operator_values:continue
                    used=model.new_bool_var(f'op{i}_{j}_{n}')
                    model.add_linear_expression_in_domain(start,cp_model.Domain.from_values(operator_values)).only_enforce_if(used)
                    model.add(used<=chosen)
                    op_interval=model.new_optional_interval_var(start,option_duration,end,used,f'oi{i}_{j}_{n}')
                    people.setdefault(p.id,[]).append(op_interval)
                    op_choices.append(used);operator_selections[t.id].append((p.id,used))
                    if not movable and t.operatorIds is not None:
                        model.add(used==(chosen if p.id in t.operatorIds else 0))
                    elif t.operatorIds is not None and p.id not in t.operatorIds:
                        costs.append(used*100)
                model.add(sum(op_choices)==t.operatorCount*chosen)
                if not movable and t.operatorIds is not None and (len(set(t.operatorIds))!=t.operatorCount or not set(t.operatorIds).issubset({p.id for p in o.operatorCandidates})):
                    model.add(chosen==0)
            support_choices=[]
            if len({p.id for p in o.laborCandidates})!=len(o.laborCandidates):return None
            for n,p in enumerate(o.laborCandidates):
                usable=sorted(set(p.allowed).intersection(allowed))
                if not usable:continue
                used=model.new_bool_var(f'lab{i}_{j}_{n}')
                model.add(used<=chosen)
                model.add_linear_expression_in_domain(start,cp_model.Domain.from_values(usable)).only_enforce_if(used)
                people.setdefault(p.personId,[]).append(model.new_optional_interval_var(start,option_duration,end,used,f'li{i}_{j}_{n}'))
                support_choices.append(used);labor_selections[t.id].append((p.id,used))
                if not movable:model.add(used==(chosen if p.id in t.laborSupportIds else 0))
                costs.append(used*100000)
            model.add(sum(support_choices)<=min(t.ordinaryWorkerCount,t.staff)*chosen)
            if not movable and not set(t.laborSupportIds).issubset({p.id for p in o.laborCandidates if set(p.allowed).intersection(allowed)}):model.add(chosen==0)
            costs.append(chosen*(100000 if o.borrowed else 0))
            if not initial and o.resource!=t.resource:costs.append(chosen*1000)
            if o.resource in exclusive:
                for day in sorted({s//32 for s in allowed}):
                    if len(resource_day_centers[(o.resource,day)])<2:continue
                    on_day=model.new_bool_var(f'exclusive_day{i}_{j}_{day}')
                    domain=cp_model.Domain.from_intervals([[day*32,day*32+31]])
                    model.add_linear_expression_in_domain(start,domain).only_enforce_if(on_day)
                    model.add_linear_expression_in_domain(start,domain.complement()).only_enforce_if(on_day.Not())
                    claim=model.new_bool_var(f'exclusive_claim{i}_{j}_{day}')
                    model.add_bool_and([chosen,on_day]).only_enforce_if(claim)
                    model.add_bool_or([chosen.Not(),on_day.Not()]).only_enforce_if(claim.Not())
                    resource_day_claims.setdefault((o.resource,day),{}).setdefault(t.resourceDayCenter,[]).append(claim)
            for pool in o.pools:
                on_day=model.new_bool_var(f'day{i}_{j}_{pool.day}')
                model.add_linear_expression_in_domain(start,cp_model.Domain.from_intervals([[pool.day*32,pool.day*32+31]])).only_enforce_if(on_day)
                model.add_linear_expression_in_domain(start,cp_model.Domain.from_intervals([[pool.day*32,pool.day*32+31]]).complement()).only_enforce_if(on_day.Not())
                claim=model.new_bool_var(f'claim{i}_{j}_{pool.day}')
                model.add_bool_and([chosen,on_day]).only_enforce_if(claim)
                model.add_bool_or([chosen.Not(),on_day.Not()]).only_enforce_if(claim.Not())
                loan_claims.setdefault((pool.id,o.resource),[]).append(claim)
                pool_caps[pool.id]=min(pool_caps.get(pool.id,pool.capacity),pool.capacity)
        model.add(sum(chosen for _,chosen in selections[t.id])==present)
        support_count=sum(b for _,b in labor_selections[t.id])
        local_staff[t.id]=model.new_int_var(0,t.staff,f'local_staff{i}')
        model.add(local_staff[t.id]==t.staff-support_count)
        if t.workerPool:
            demand=t.capacityDemands.get(t.workerPool,0)
            if demand<0:return None
            local_workers[t.id]=model.new_int_var(0,demand,f'local_workers{i}')
            model.add(local_workers[t.id]==demand-support_count)
        if t.person:people.setdefault(t.person,[]).append(interval)
        if t.field:fields.setdefault(t.field,[]).append(interval)
        date=model.new_int_var(min(values)//32-1,max(values)//32+1,f'd{i}')
        model.add_division_equality(date,start,32)
        deviation=model.new_int_var(0,max(abs(s-t.original) for s in values),f'dev{i}')
        model.add_abs_equality(deviation,start-t.original)
        if initial:
            # Maximize required operations, then all operations, then choose an
            # early/local placement. Partial output can never be approved as a
            # complete cultivation; prerequisites must also be present below.
            if optional:costs.append((1-present)*initial_bound*((len(req.tasks)+1) if t.required else 1))
            costs.append(deviation+duration)
        elif t.selected:
            target=t.preferred if t.preferred is not None else t.original//32
            distance=model.new_int_var(0,100000,f'pref{i}')
            model.add_abs_equality(distance,date-target)
            # Same-date substitutes before postponement; no fixed day-3 cutoff.
            costs.append(distance*date_weight+deviation)
        else:
            changed=model.new_bool_var(f'changed{i}')
            model.add(start!=t.original).only_enforce_if(changed)
            model.add(start==t.original).only_enforce_if(changed.Not())
            near=t.original<req.freezeBefore+64
            costs.append(changed*(2000000 if near else 1000000)+deviation)
    for t in req.tasks:
        for predecessor in set(t.predecessors+([t.predecessor] if t.predecessor else [])):
            if predecessor in ends:
                model.add(presence[t.id]<=presence[predecessor])
                model.add(starts[t.id]>=ends[predecessor]).only_enforce_if([presence[t.id],presence[predecessor]])
    for items in [*resources.values(),*people.values(),*fields.values()]:model.add_no_overlap(items)
    for key,centers in resource_day_claims.items():
        used=[]
        for center,claims in centers.items():
            occupied=model.new_bool_var(f'exclusive_center_{key}_{center}')
            model.add_max_equality(occupied,claims);used.append(occupied)
        model.add(sum(used)<=1)
    pools={}
    for (pool_id,resource),claims in loan_claims.items():
        used=model.new_bool_var('loan_'+pool_id+'_'+str(resource));model.add_max_equality(used,claims)
        pools.setdefault(pool_id,[]).append(used)
    for pool_id,used in pools.items():model.add(sum(used)<=pool_caps[pool_id])
    blocks=[model.new_fixed_size_interval_var(b.start,b.duration,f'capacity_block{i}') for i,b in enumerate(req.capacityBlocks)]
    model.add_cumulative(intervals+blocks,[local_staff[t.id] for t in req.tasks]+[b.staff for b in req.capacityBlocks],req.staffCapacity)
    model.add_cumulative(intervals,[t.transport for t in req.tasks],req.transportCapacity)
    # Qualified pools never borrow capacity implicitly across centers or trades.
    keys = set(k for t in req.tasks for k in t.capacityDemands)|set(k for b in req.capacityBlocks for k in b.capacityDemands)
    for key in keys:
        if key not in req.capacityLimits or req.capacityLimits[key] < 0:
            return None
        if any(t.capacityDemands.get(key,0)<0 for t in req.tasks) or any(b.capacityDemands.get(key,0)<0 for b in req.capacityBlocks):
            return None
        demands = [local_workers[t.id] if t.workerPool==key else t.capacityDemands.get(key,0) for t in req.tasks]+[b.capacityDemands.get(key,0) for b in req.capacityBlocks]
        model.add_cumulative(intervals+blocks, demands, req.capacityLimits[key])
    model.minimize(sum(costs));solver=cp_model.CpSolver()
    solver.parameters.max_time_in_seconds=time_limit;solver.parameters.num_search_workers=1
    status=solver.solve(model)
    if status not in (cp_model.OPTIMAL,cp_model.FEASIBLE):return None
    return {'assignments':[{'id':t.id,'start':solver.value(starts[t.id]),**({'duration':solver.value(durations[t.id])} if initial else {}),'resource':next(o.resource for o,b in selections[t.id] if solver.value(b)),**({'operatorIds':sorted(p for p,b in operator_selections[t.id] if solver.value(b))} if t.operatorCount is not None else {}),**({'laborSupportIds':sorted(p for p,b in labor_selections[t.id] if solver.value(b))} if t.ordinaryWorkerCount or t.laborSupportIds else {})} for t in req.tasks if solver.value(presence[t.id])], 'unassigned':[t.id for t in req.tasks if not solver.value(presence[t.id])], 'optimal':status==cp_model.OPTIMAL}

def replan(req:Request):
    return {**(_large_replan(req) if len(req.tasks)>600 else _replan(req)),'contractVersion':CONTRACT_VERSION,'capacityPoolsVersion':'qualified-pools-v1','operatorVersion':'named-operators-v1','largeScheduleVersion':'resource-time-components-v2','laborCapacityVersion':'confirmed-labor-v1','resourceDayVersion':'exclusive-center-days-v1'}

def _large_replan(req:Request):
    """Split independent resource/time components, not centers or row counts.
    Field/equipment/people/crew/loan claims and related precedence stay together.
    Oversized related components fail closed, leaving all DB records untouched.
    """
    if len({t.id for t in req.tasks})!=len(req.tasks):return {'status':'INVALID'}
    components=scheduling_components(req.tasks)
    diagnostics={'components':len(components),'largestComponent':max(map(len,components),default=0)}
    if any(len(c)>600 for c in components):
        return {'status':'NO_FEASIBLE_PLAN',**diagnostics,'reason':f'연결된 혼잡 구간 {max(map(len,components))}건은 한 번의 안전 계산 한도(600건)를 초과합니다. 센터·작업기간별 병목 검토가 필요합니다. 임의 분할·부분 승인을 하지 않았습니다.'}
    deadline=monotonic()+30
    all_assignments=[];unassigned=[];phases=[]
    for index,component in enumerate(components):
        if monotonic()>=deadline:return {'status':'NO_FEASIBLE_PLAN',**diagnostics,'reason':'전체 계산 시간 한도에 도달했습니다. 부분 결과는 적용하지 않았습니다.'}
        blocked=set(unassigned)
        for _ in range(len(component)):
            old=len(blocked)
            for t in component:
                if any(p in blocked for p in t.predecessors+([t.predecessor] if t.predecessor else [])):blocked.add(t.id)
            if len(blocked)==old:break
        active=[]
        for t in component:
            if t.id in blocked:
                if req.purpose!='INITIAL' or not t.optional or t.locked:return {'status':'NO_FEASIBLE_PLAN',**diagnostics,'reason':'선행 작업의 배치가 필요합니다.'}
                unassigned.append(t.id);blocked.add(t.id)
            else:active.append(t)
        if not active:continue
        sub=req.model_copy(update={'tasks':active})
        # Share the bounded search budget: small late-season components must
        # not each consume another five seconds after the busy ones finish.
        # Once real loan dates and locked bookings split out many tiny
        # components, sqrt weighting starves the remaining congested interval.
        # Share the same 30-second budget by task count; retain the 5s phase cap.
        weight=sum(len(c) for c in components[index:])
        budget=min(5,max(0.001,(deadline-monotonic()-0.5)*len(component)/weight))
        result=_replan(sub,deadline,budget)
        if result['status']!='FEASIBLE':return {**result,**diagnostics}
        if monotonic()>=deadline:return {'status':'NO_FEASIBLE_PLAN',**diagnostics,'reason':'전체 계산 시간 한도에 도달했습니다. 부분 결과는 적용하지 않았습니다.'}
        all_assignments.extend(result['assignments']);unassigned.extend(result.get('unassigned',[]));phases.append(result['phase'])
    phase='INITIAL_DISPATCH' if req.purpose=='INITIAL' else ('REBUILD_APPROVED' if req.rebuildMode=='EXPAND' else 'REBUILD_RELATED' if 'REBUILD_RELATED' in phases else 'GAPS_ONLY')
    # Presence decisions across seasonal prerequisites can affect later yield;
    # independent phases do not prove a globally optimal partial admission.
    return {'status':'FEASIBLE','phase':phase,'assignments':all_assignments,'unassigned':unassigned,'optimal':False,**diagnostics}

def _replan(req:Request,deadline:float|None=None,budget:float=5):
    if len({t.id for t in req.tasks})!=len(req.tasks):return {'status':'INVALID'}
    if req.purpose=='INITIAL':
        result=attempt(req,False,min(budget,max(0.001,deadline-monotonic())) if deadline else budget)
        return {'status':'FEASIBLE','phase':'INITIAL_DISPATCH',**result} if result is not None else {'status':'NO_FEASIBLE_PLAN','reason':'계산 시간 내 기존 확정 일정과 새 작업 제약을 만족하는 배치를 찾지 못했습니다.'}
    phases=[False] if req.rebuildMode=='PRESERVE' else [True] if req.rebuildMode=='EXPAND' else [False,True]
    first=None
    for expand in phases:
        if deadline and monotonic()>=deadline:break
        result=attempt(req,expand,min(budget,max(0.001,deadline-monotonic())) if deadline else budget)
        if result is None:continue
        out={'status':'FEASIBLE','phase':('REBUILD_APPROVED' if req.rebuildMode=='EXPAND' else 'REBUILD_RELATED') if expand else 'GAPS_ONLY',**result}
        def distance(r):
            a={x['id']:x['start'] for x in r['assignments']}
            return sum(abs(a[t.id]//32-t.preferred) for t in req.tasks if t.selected and t.preferred is not None)
        if not expand and req.rebuildMode=='AUTO' and distance(out)>0:first=out;continue
        if first and distance(first)<=distance(out):return first
        return out
    if first:return first
    return {'status':'NO_FEASIBLE_PLAN','reason':'계산 시간 내 작업기간·장비·인력·운송·고정 일정 제약을 함께 만족하는 배치를 찾지 못했습니다.'}
