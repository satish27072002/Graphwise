FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system appuser \
    && useradd --system --create-home --gid appuser --shell /usr/sbin/nologin appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data

COPY shared /shared
RUN pip install --no-cache-dir -e /shared

COPY services/workers/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/workers/ .
RUN chown -R appuser:appuser /app

USER appuser

CMD ["celery", "-A", "celery_app", "worker", "-Q", "pipeline", "--loglevel=INFO"]
