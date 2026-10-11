"""Isolated test adapter: same production solver, stdin/stdout only, no service."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from solver.replanning import Request, replan

if __name__ == '__main__':
    result = replan(Request.model_validate(json.load(sys.stdin)))
    print(json.dumps(result, ensure_ascii=True))
