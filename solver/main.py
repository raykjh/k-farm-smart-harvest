from fastapi import FastAPI
from pydantic import BaseModel, Field
from ortools.sat.python import cp_model

app = FastAPI(title='K-Farm deterministic scheduler')
from solver.replanning import Request as ReplanRequest, replan
@app.post('/schedule')
@app.post('/replan')
def replan_api(req: ReplanRequest):
    return replan(req)

class Job(BaseModel):
    id: str
    resourceId: str
    start: int = Field(ge=0)
    duration: int = Field(ge=1, le=32)
    deadline: int = Field(ge=1, le=320)
    priority: int = Field(ge=1, le=10)
    batchKey: str
    blockedWindows: list[tuple[int,int]] = []
    fixedStart: int | None = None

class SolveRequest(BaseModel):
    jobs: list[Job] = Field(max_length=600)
    blockedUntil: int = Field(default=0, ge=0, le=320)
    unavailable: list[str] = []
    staffCount: int = Field(default=2, ge=0, le=20)
    transportCount: int = Field(default=1, ge=0, le=10)
    preferBatch: bool = True

@app.get('/health')
def health(): return {'status':'ok','engine':'OR-Tools CP-SAT','contractVersion':'shared-schedule-v1','capacityPoolsVersion':'qualified-pools-v1','operatorVersion':'named-operators-v1','largeScheduleVersion':'resource-time-components-v2','laborCapacityVersion':'confirmed-labor-v1','resourceDayVersion':'exclusive-center-days-v1','limits':{'requestTasks':5000,'connectedTasks':600},'units':'15 minute slots; 08:00-16:00 workdays'}

@app.post('/solve')
def solve_api(req: SolveRequest):
    return {**solve(req), 'contractVersion':'weather-v2'}

def solve(req: SolveRequest):
    if not req.jobs: return {'status':'FEASIBLE','assignments':[], 'groups':0}
    if req.staffCount == 0 or req.transportCount == 0 or any(j.resourceId in req.unavailable for j in req.jobs):
        return {'status':'NO_FEASIBLE_PLAN','reason':'Required equipment, transport or staff unavailable'}
    # Contiguous compatible fields share a setup. No cross-crop/product batching.
    groups = {}
    for j in req.jobs:
        key = (j.resourceId, j.batchKey + str(j.blockedWindows)) if req.preferBatch and j.fixedStart is None else (j.resourceId,j.id)
        groups.setdefault(key, []).append(j)
    model = cp_model.CpModel()
    resources, all_intervals, terms, records = {}, [], [], []
    for idx, ((resource,_), jobs) in enumerate(groups.items()):
        duration = sum(j.duration for j in jobs)
        latest = min(j.deadline for j in jobs)
        earliest = max(req.blockedUntil, min(j.start for j in jobs))
        # Tasks cannot straddle a workday boundary; transport/setup included.
        windows=[w for j in jobs for w in j.blockedWindows]
        fixed=jobs[0].fixedStart
        allowed = [s for s in range(earliest,latest-duration+1) if s%32+duration<=32 and (fixed is None or s==fixed) and not any(s<end and s+duration>begin for begin,end in windows)]
        if not allowed: return {'status':'NO_FEASIBLE_PLAN','reason':'Safe work window exhausted'}
        start = model.new_int_var_from_domain(cp_model.Domain.from_values(allowed),f's{idx}')
        end = model.new_int_var(0,320,f'e{idx}')
        interval = model.new_interval_var(start,duration,end,f'i{idx}')
        resources.setdefault(resource,[]).append(interval)
        all_intervals.append(interval)
        terms.append(start * max(j.priority for j in jobs))
        records.append((start,jobs))
    for intervals in resources.values(): model.add_no_overlap(intervals)
    # Conservative first-slice reservation: vehicle and worker held through work.
    model.add_cumulative(all_intervals,[1]*len(all_intervals),req.staffCount)
    model.add_cumulative(all_intervals,[1]*len(all_intervals),req.transportCount)
    model.minimize(sum(terms))
    solver=cp_model.CpSolver(); solver.parameters.max_time_in_seconds=8
    solver.parameters.num_search_workers=1; solver.parameters.random_seed=7
    status=solver.solve(model)
    if status not in (cp_model.OPTIMAL,cp_model.FEASIBLE):
        return {'status':'NO_FEASIBLE_PLAN','reason':'No conflict-free schedule within safe deadlines'}
    assignments=[]
    for start,jobs in records:
        offset=solver.value(start)
        for n,j in enumerate(jobs):
            effective=j.duration
            assignments.append({'missionId':j.id,'start':offset,'duration':effective})
            offset+=effective
    return {'status':'FEASIBLE','assignments':assignments,'groups':len(groups),'objective':solver.objective_value,'optimal':status==cp_model.OPTIMAL}
