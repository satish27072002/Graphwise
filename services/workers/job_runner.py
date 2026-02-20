from __future__ import annotations

import logging
import json
import os
import random
import shutil
import socket
import time
import uuid
import zipfile
from pathlib import Path
from typing import Final
from urllib import error as urlerror
from urllib import request as urlrequest

from celery.exceptions import MaxRetriesExceededError
from sqlalchemy import select

from celery_app import celery_app
from db import SessionLocal
from models import Job
from parse_graph import write_graph_facts


logger = logging.getLogger(__name__)


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


MAX_ATTEMPTS: Final[int] = 3
MB: Final[int] = 1024 * 1024
DATA_DIR: Final[Path] = Path(os.getenv("DATA_DIR", "/data"))
REPOS_DIR: Final[Path] = DATA_DIR / "repos"
UPLOADS_DIR: Final[Path] = DATA_DIR / "uploads"
ARTIFACTS_DIR: Final[Path] = DATA_DIR / "artifacts"
GRAPH_SERVICE_URL: Final[str] = os.getenv("GRAPH_SERVICE_URL", "http://graph_service:8002")
NEO4J_URL: Final[str] = os.getenv("NEO4J_URL") or os.getenv("NEO4J_URI") or "bolt://neo4j:7687"
GRAPH_LOAD_TIMEOUT_SEC: Final[int] = int(os.getenv("GRAPH_LOAD_TIMEOUT_SEC", "30"))
# Keep embed timeout configurable and high enough for large repositories.
PIPELINE_EMBED_TIMEOUT_SEC: Final[int] = int(
    os.getenv("PIPELINE_EMBED_TIMEOUT_SEC", os.getenv("GRAPH_EMBED_TIMEOUT_SEC", "60"))
)
PIPELINE_EMBED_MAX_RETRIES: Final[int] = max(1, int(os.getenv("PIPELINE_EMBED_MAX_RETRIES", "10")))
PIPELINE_EMBED_BACKOFF_BASE_SEC: Final[float] = float(os.getenv("PIPELINE_EMBED_BACKOFF_BASE_SEC", "1"))
PIPELINE_EMBED_BACKOFF_MAX_SEC: Final[float] = float(os.getenv("PIPELINE_EMBED_BACKOFF_MAX_SEC", "30"))
ENABLE_EMBEDDINGS: Final[bool] = _parse_bool(os.getenv("ENABLE_EMBEDDINGS"), True)
MAX_ZIP_MB: Final[int] = int(os.getenv("MAX_ZIP_MB", "50"))
MAX_FILES: Final[int] = int(os.getenv("MAX_FILES", "20000"))
MAX_TOTAL_UNZIPPED_MB: Final[int] = int(os.getenv("MAX_TOTAL_UNZIPPED_MB", "500"))
TRANSIENT_EMBED_HTTP_STATUSES: Final[set[int]] = {502, 503, 504}


class EmbedStepFailed(RuntimeError):
    """Raised when embed step exhausts retries or fails non-transiently."""


def _repo_path(repo_id: uuid.UUID) -> Path:
    return REPOS_DIR / str(repo_id)


def _zip_path(repo_id: uuid.UUID) -> Path:
    return UPLOADS_DIR / f"{repo_id}.zip"


def _facts_path(repo_id: uuid.UUID) -> Path:
    return ARTIFACTS_DIR / str(repo_id) / "graph_facts.json"


def _is_within_directory(target: Path, root: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def _safe_extract_zip(zip_file: Path, extract_dir: Path) -> None:
    max_zip_bytes = MAX_ZIP_MB * MB
    max_total_unzipped_bytes = MAX_TOTAL_UNZIPPED_MB * MB
    zip_size = zip_file.stat().st_size
    if zip_size > max_zip_bytes:
        raise RuntimeError(f"ZIP size {zip_size} bytes exceeds MAX_ZIP_MB={MAX_ZIP_MB}.")

    root = extract_dir.resolve()
    file_count = 0
    total_unzipped_bytes = 0

    with zipfile.ZipFile(zip_file) as archive:
        infos = archive.infolist()

        for info in infos:
            member_name = info.filename
            destination = (extract_dir / member_name).resolve()
            if not _is_within_directory(destination, root):
                raise RuntimeError(f"Unsafe ZIP member path: {member_name}")

            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise RuntimeError(f"ZIP symlink entries are not allowed: {member_name}")

            if info.is_dir():
                continue

            file_count += 1
            if file_count > MAX_FILES:
                raise RuntimeError(f"ZIP contains too many files; MAX_FILES={MAX_FILES}.")

            total_unzipped_bytes += info.file_size
            if total_unzipped_bytes > max_total_unzipped_bytes:
                raise RuntimeError(
                    "ZIP uncompressed size exceeds "
                    f"MAX_TOTAL_UNZIPPED_MB={MAX_TOTAL_UNZIPPED_MB}."
                )

        for info in infos:
            member_name = info.filename
            destination = (extract_dir / member_name).resolve()
            if info.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue

            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info, "r") as src, destination.open("wb") as dst:
                shutil.copyfileobj(src, dst)


def _ingest_zip(repo_id: uuid.UUID) -> None:
    repo_dir = _repo_path(repo_id)
    if repo_dir.exists():
        logger.info("repo already exists, skipping unzip", extra={"repo_id": str(repo_id)})
        return

    zip_file = _zip_path(repo_id)
    if not zip_file.exists():
        raise RuntimeError(f"ZIP upload not found at {zip_file}.")

    REPOS_DIR.mkdir(parents=True, exist_ok=True)
    tmp_dir = REPOS_DIR / f".{repo_id}.tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    try:
        _safe_extract_zip(zip_file, tmp_dir)
        tmp_dir.rename(repo_dir)
    except Exception:
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)
        raise


def _run_ingest(job: Job) -> None:
    if job.job_type == "PIPELINE_INGEST_ZIP":
        _ingest_zip(job.repo_id)
        return
    raise RuntimeError(f"Unsupported job_type for ingest: {job.job_type}")


def _run_parse(repo_id: uuid.UUID) -> Path:
    repo_dir = _repo_path(repo_id)
    if not repo_dir.exists():
        raise RuntimeError(f"Cannot parse missing repo directory: {repo_dir}")
    return write_graph_facts(repo_id, repo_dir, artifacts_root=ARTIFACTS_DIR)


def _run_load_graph(repo_id: uuid.UUID) -> None:
    facts_path = _facts_path(repo_id)
    if not facts_path.exists():
        raise RuntimeError(f"Missing graph facts file: {facts_path}")

    endpoint = f"{GRAPH_SERVICE_URL.rstrip('/')}/graph/load"
    payload = json.dumps(
        {
            "repo_id": str(repo_id),
            "facts_path": str(facts_path),
        }
    ).encode("utf-8")
    req = urlrequest.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=GRAPH_LOAD_TIMEOUT_SEC) as response:
            body = response.read().decode("utf-8")
            if response.status >= 400:
                raise RuntimeError(f"graph_service returned {response.status}: {body}")
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"graph_service load failed ({exc.code}): {detail}") from exc
    except urlerror.URLError as exc:
        raise RuntimeError(f"graph_service unreachable: {exc.reason}") from exc


def _run_embed(repo_id: uuid.UUID) -> None:
    if not ENABLE_EMBEDDINGS:
        logger.info("embeddings disabled; skipping embed", extra={"repo_id": str(repo_id)})
        return

    endpoint = f"{GRAPH_SERVICE_URL.rstrip('/')}/graph/embed"
    payload = json.dumps({"repo_id": str(repo_id)}).encode("utf-8")
    last_status: int | None = None
    last_detail = ""

    for attempt in range(1, PIPELINE_EMBED_MAX_RETRIES + 1):
        req = urlrequest.Request(
            endpoint,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlrequest.urlopen(req, timeout=PIPELINE_EMBED_TIMEOUT_SEC) as response:
                body = response.read().decode("utf-8")
                if response.status >= 400:
                    last_status = response.status
                    last_detail = body.strip()
                    raise EmbedStepFailed(
                        "embed step failed: "
                        f"attempts_used={attempt}, "
                        f"last_http_status={last_status}, "
                        f"last_response_detail={last_detail or 'empty response body'}"
                    )
                return
        except urlerror.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore").strip()
            last_status = int(exc.code)
            last_detail = detail

            if last_status not in TRANSIENT_EMBED_HTTP_STATUSES:
                raise EmbedStepFailed(
                    "embed step failed with non-retryable upstream response: "
                    f"attempts_used={attempt}, "
                    f"last_http_status={last_status}, "
                    f"last_response_detail={last_detail or 'empty response body'}"
                ) from exc

            if attempt < PIPELINE_EMBED_MAX_RETRIES:
                backoff_cap = min(
                    PIPELINE_EMBED_BACKOFF_MAX_SEC,
                    PIPELINE_EMBED_BACKOFF_BASE_SEC * (2 ** (attempt - 1)),
                )
                sleep_sec = random.uniform(0.0, max(0.0, backoff_cap))
                logger.warning(
                    "embed retry scheduled (http)",
                    extra={
                        "repo_id": str(repo_id),
                        "attempt": attempt,
                        "max_attempts": PIPELINE_EMBED_MAX_RETRIES,
                        "status": last_status,
                        "sleep_sec": round(sleep_sec, 3),
                        "detail": last_detail,
                    },
                )
                time.sleep(sleep_sec)
                continue
        except (urlerror.URLError, TimeoutError, socket.timeout) as exc:
            reason = getattr(exc, "reason", exc)
            last_status = None
            last_detail = str(reason).strip() or exc.__class__.__name__

            if attempt < PIPELINE_EMBED_MAX_RETRIES:
                backoff_cap = min(
                    PIPELINE_EMBED_BACKOFF_MAX_SEC,
                    PIPELINE_EMBED_BACKOFF_BASE_SEC * (2 ** (attempt - 1)),
                )
                sleep_sec = random.uniform(0.0, max(0.0, backoff_cap))
                logger.warning(
                    "embed retry scheduled (network/timeout)",
                    extra={
                        "repo_id": str(repo_id),
                        "attempt": attempt,
                        "max_attempts": PIPELINE_EMBED_MAX_RETRIES,
                        "sleep_sec": round(sleep_sec, 3),
                        "detail": last_detail,
                    },
                )
                time.sleep(sleep_sec)
                continue

        # Retries exhausted for transient failures.
        break

    raise EmbedStepFailed(
        "embed step failed after retries: "
        f"attempts_used={PIPELINE_EMBED_MAX_RETRIES}, "
        f"last_http_status={last_status if last_status is not None else 'timeout_or_network_error'}, "
        f"last_response_detail={last_detail or 'no detail'}"
    )


def _get_locked_job(session, job_uuid: uuid.UUID) -> Job | None:
    stmt = select(Job).where(Job.job_id == job_uuid).with_for_update()
    return session.execute(stmt).scalar_one_or_none()


@celery_app.task(bind=True, name="pipeline.run_job")
def run_pipeline_job(
    self,
    job_id: str,
    **_unused: object,
) -> dict[str, str]:
    job_uuid = uuid.UUID(job_id)

    with SessionLocal.begin() as session:
        job = _get_locked_job(session, job_uuid)
        if job is None:
            logger.warning("job not found", extra={"job_id": job_id})
            return {"status": "missing"}

        if job.status == "completed":
            logger.info("job already completed", extra={"job_id": job_id})
            return {"status": "completed"}

        if job.status == "running":
            logger.info("job already running", extra={"job_id": job_id})
            return {"status": "running"}

        job.status = "running"
        job.error = None
        job.current_step = "INGEST"
        job.progress = max(job.progress or 0, 1)

    try:
        with SessionLocal.begin() as session:
            job = _get_locked_job(session, job_uuid)
            if job is None:
                return {"status": "missing"}
            _run_ingest(job)
            job.current_step = "INGEST"
            job.progress = 25

        with SessionLocal.begin() as session:
            job = _get_locked_job(session, job_uuid)
            if job is None:
                return {"status": "missing"}
            artifact_path = _run_parse(job.repo_id)
            job.current_step = "PARSE"
            job.progress = 50
            logger.info(
                "parse.artifact_written",
                extra={"job_id": job_id, "artifact_path": str(artifact_path)},
            )

        with SessionLocal.begin() as session:
            job = _get_locked_job(session, job_uuid)
            if job is None:
                return {"status": "missing"}
            _run_load_graph(job.repo_id)
            job.current_step = "LOAD_GRAPH"
            job.progress = 75

        with SessionLocal.begin() as session:
            job = _get_locked_job(session, job_uuid)
            if job is None:
                return {"status": "missing"}
            _run_embed(job.repo_id)
            job.current_step = "EMBED"
            job.progress = 90

        with SessionLocal.begin() as session:
            job = _get_locked_job(session, job_uuid)
            if job is None:
                return {"status": "missing"}

            job.status = "completed"
            job.progress = 100
            job.current_step = "EMBED"
            job.error = None

        logger.info("job completed", extra={"job_id": job_id})
        return {"status": "completed"}

    except Exception as exc:
        retry_job = False

        with SessionLocal.begin() as session:
            job = _get_locked_job(session, job_uuid)
            if job is None:
                return {"status": "missing"}

            job.attempts = (job.attempts or 0) + 1
            job.error = str(exc)

            if isinstance(exc, EmbedStepFailed):
                # Embed step already applies its own retry policy; fail immediately here.
                job.status = "failed"
                retry_job = False
            elif job.attempts >= MAX_ATTEMPTS:
                job.status = "failed"
                retry_job = False
            else:
                job.status = "queued"
                retry_job = True

        if retry_job:
            logger.warning(
                "job failed, retrying",
                extra={"job_id": job_id, "attempts": job.attempts},
            )
            try:
                raise self.retry(exc=exc, countdown=2)
            except MaxRetriesExceededError:
                with SessionLocal.begin() as session:
                    job = _get_locked_job(session, job_uuid)
                    if job is not None:
                        job.status = "failed"
                        job.error = str(exc)
                return {"status": "failed"}

        logger.exception("job failed", extra={"job_id": job_id})
        return {"status": "failed"}
