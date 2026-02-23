FROM python:3.11-slim

WORKDIR /app

COPY shared /shared
RUN pip install --no-cache-dir -e /shared

COPY services/retrieval_service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/retrieval_service/app ./app

EXPOSE 8003

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
