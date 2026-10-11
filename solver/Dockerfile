FROM python:3.12-slim
WORKDIR /app
COPY solver/requirements.txt solver/constraints.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY solver /app/solver
CMD ["uvicorn", "solver.main:app", "--host", "0.0.0.0", "--port", "8100"]
