FROM python:3.11-slim

WORKDIR /app

COPY shared /shared
RUN pip install --no-cache-dir -e /shared

COPY services/graph_service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/graph_service/app ./app

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
