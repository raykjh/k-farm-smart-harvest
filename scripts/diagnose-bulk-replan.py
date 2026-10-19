"""Read a synthetic E2E contract and inspect search status without DB/API writes.

This is a diagnostic, NOT a replacement production solver. A witness hint, when
requested, only demonstrates search behavior after the TypeScript verifier has
already checked that witness against the identical scheduling contract.
"""
import argparse
import json
from pathlib import Path
import sys
from time import monotonic

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from solver import replanning

parser = argparse.ArgumentParser()
parser.add_argument("path")
parser.add_argument("--seconds", type=float, default=5)
parser.add_argument("--witness-hint", action="store_true")
args = parser.parse_args()
path = Path(args.path).resolve()
root = Path(__file__).resolve().parents[1] / ".data" / "validation" / "20261012-bulk-ui"
if root not in path.parents or not 0 < args.seconds <= 30:
    raise SystemExit("Only the isolated synthetic bulk evidence is supported.")
evidence = json.loads(path.read_text(encoding="utf-8"))
request = replanning.Request.model_validate(evidence["contract"])
witness = {a["id"]: a for a in evidence["witness"]}
diagnostics = {}
BaseSolver = replanning.cp_model.CpSolver


class DiagnosticSolver(BaseSolver):
    def solve(self, model, *params, **kwargs):
        if args.witness_hint:
            if not evidence.get("feasibleWitnessVerified"):
                raise RuntimeError("A verified witness is required.")
            hints = {f"s{i}": witness[t.id]["start"] for i, t in enumerate(request.tasks)}
            for i, variable in enumerate(model.proto.variables):
                if variable.name in hints:
                    model.add_hint(model.get_int_var_from_proto_index(i), hints[variable.name])
        status = super().solve(model, *params, **kwargs)
        diagnostics.update(
            solverStatus=self.status_name(status),
            wallSeconds=round(self.wall_time, 3),
            branches=self.num_branches,
            conflicts=self.num_conflicts,
            objective=self.objective_value,
            bestBound=self.best_objective_bound,
        )
        return status


replanning.cp_model.CpSolver = DiagnosticSolver
start = monotonic()
result = replanning.attempt(request, request.rebuildMode == "EXPAND", args.seconds)
assignments = {a["id"]: a for a in result["assignments"]} if result else {}
distances = [abs(assignments[t.id]["start"] // 32 - t.preferred) for t in request.tasks if t.selected and t.preferred is not None] if result else []
print(json.dumps({
    "case": evidence["case"], "taskCount": len(request.tasks),
    "timeLimitSeconds": args.seconds, "diagnosticWitnessHint": args.witness_hint,
    "witnessVerified": evidence["feasibleWitnessVerified"],
    "elapsedSeconds": round(monotonic() - start, 3),
    "result": "FEASIBLE" if result else "NONE", "optimal": result.get("optimal") if result else None,
    "selectedDateDistanceHistogram": {str(n): distances.count(n) for n in sorted(set(distances))},
    **diagnostics,
}))
