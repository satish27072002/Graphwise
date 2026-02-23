from __future__ import annotations

import logging
import os
import shutil
import time
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from codegraph_shared.http_utils import get_json as _shared_get_json, post_json as _shared_post_json

from .config import get_settings
from .db import engine, get_db_session
from .logging_config import configure_logging, request_id_context
from .models import Base, Job
from .queue import enqueue_kg_ingest_job, enqueue_pipeline_job
from .schemas import (
    GraphPayload,
    JobCreatedResponse,
    JobStatusResponse,
    KGStatusResponse,
    QueryRequest,
    RepoStatusResponse,
    UnifiedQueryResponse,
)


configure_logging()
logger = logging.getLogger("api_gateway")
settings = get_settings()

app = FastAPI(title="api_gateway")

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    request.state.request_id = request_id
    token = request_id_context.set(request_id)
    started = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.exception(
            "request.failed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "duration_ms": duration_ms,
            },
        )
        request_id_context.reset(token)
        raise

    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["x-request-id"] = request_id
    logger.info(
        "request.completed",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    request_id_context.reset(token)
    return response


@app.on_event("startup")
async def startup() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("db.ready", extra={"database_url": settings.database_url})


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


def _post_svc(base_url: str, path: str, payload: dict) -> dict:
    url = f"{base_url.rstrip('/')}{path}"
    return _shared_post_json(url, payload, float(settings.service_timeout_sec))


def _get_svc(base_url: str, path: str, params: dict[str, str]) -> dict:
    url = f"{base_url.rstrip('/')}{path}"
    return _shared_get_json(url, params, float(settings.service_timeout_sec))


async def _create_pipeline_job(
    session: AsyncSession,
    *,
    repo_id: uuid.UUID,
    job_type: str,
) -> Job:
    job = Job(
        repo_id=repo_id,
        job_type=job_type,
        status="queued",
        progress=0,
        current_step="INGEST",
        attempts=0,
        error=None,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


@app.post("/ingest/zip", response_model=JobCreatedResponse)
async def ingest_zip(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_db_session),
) -> JobCreatedResponse:
    repo_id = uuid.uuid4()
    job = await _create_pipeline_job(
        session,
        repo_id=repo_id,
        job_type="PIPELINE_INGEST_ZIP",
    )

    uploads_dir = Path(settings.data_dir) / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    target_path = uploads_dir / f"{repo_id}.zip"
    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    await file.close()

    logger.info(
        "job.created",
        extra={
            "job_id": str(job.job_id),
            "repo_id": str(repo_id),
            "job_type": job.job_type,
            "source": "zip",
            "saved_to": os.fspath(target_path),
        },
    )
    try:
        enqueue_pipeline_job(job.job_id)
    except Exception:
        logger.exception(
            "job.enqueue_failed",
            extra={"job_id": str(job.job_id), "repo_id": str(repo_id)},
        )

    return JobCreatedResponse(job_id=job.job_id, repo_id=repo_id)


@app.post("/ingest/kg/zip", response_model=JobCreatedResponse)
async def ingest_kg_zip(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_db_session),
) -> JobCreatedResponse:
    repo_id = uuid.uuid4()
    job = await _create_pipeline_job(
        session,
        repo_id=repo_id,
        job_type="PIPELINE_KG_INGEST_ZIP",
    )

    uploads_dir = Path(settings.data_dir) / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    target_path = uploads_dir / f"{repo_id}.zip"
    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    await file.close()

    logger.info(
        "job.created",
        extra={
            "job_id": str(job.job_id),
            "repo_id": str(repo_id),
            "job_type": job.job_type,
            "source": "kg_zip",
            "saved_to": os.fspath(target_path),
        },
    )
    try:
        enqueue_kg_ingest_job(job_id=job.job_id, repo_id=repo_id)
        logger.info(
            "queued run_kg_ingest",
            extra={
                "job_id": str(job.job_id),
                "repo_id": str(repo_id),
                "task_name": "pipeline.run_kg_ingest",
            },
        )
    except Exception:
        logger.exception(
            "job.enqueue_failed",
            extra={"job_id": str(job.job_id), "repo_id": str(repo_id)},
        )

    return JobCreatedResponse(job_id=job.job_id, repo_id=repo_id)


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(
    job_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> JobStatusResponse:
    job = await session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return JobStatusResponse.model_validate(job)


@app.get("/jobs", response_model=list[JobStatusResponse])
async def list_jobs(
    repo_id: uuid.UUID = Query(...),
    session: AsyncSession = Depends(get_db_session),
) -> list[JobStatusResponse]:
    stmt = select(Job).where(Job.repo_id == repo_id).order_by(desc(Job.created_at))
    rows = (await session.scalars(stmt)).all()
    return [JobStatusResponse.model_validate(row) for row in rows]


@app.post("/query", response_model=UnifiedQueryResponse)
def query_repo(payload: QueryRequest) -> UnifiedQueryResponse:
    repo_id = str(payload.repo_id)

    # Retrieve from code graph
    retrieval_pack = _post_svc(
        settings.retrieval_service_url,
        "/retrieve",
        {"repo_id": repo_id, "question": payload.question},
    )

    # Retrieve from KG graph (best-effort — don't fail if KG is empty)
    kg_context: dict | None = None
    try:
        kg_result = _post_svc(
            settings.retrieval_service_url,
            "/kg/query",
            {
                "repo_id": repo_id,
                "question": payload.question,
                "top_k_chunks": 10,
                "hops": 1,
            },
        )
        kg_context = kg_result
    except HTTPException as exc:
        logger.warning(
            "query.kg_retrieval_failed repo_id=%s detail=%s",
            repo_id,
            exc.detail,
        )

    # Single LLM call with combined context
    llm_response = _post_svc(
        settings.llm_service_url,
        "/answer",
        {
            "repo_id": repo_id,
            "question": payload.question,
            "retrieval_pack": retrieval_pack,
            "kg_context": kg_context,
        },
    )

    citations_raw = llm_response.get("citations", [])
    citations = [str(item) for item in citations_raw] if isinstance(citations_raw, list) else []
    warning = llm_response.get("warning")

    # Build typed GraphPayload from the llm_service graph dict
    raw_graph = llm_response.get("graph", {"nodes": [], "edges": []})
    graph = GraphPayload(
        nodes=[
            {"id": n.get("id", ""), "type": n.get("type", "file"), "label": n.get("label", ""), "path": n.get("path")}
            for n in raw_graph.get("nodes", [])
            if isinstance(n, dict) and n.get("id")
        ],
        edges=[
            {"id": e.get("id", ""), "source": e.get("source", ""), "target": e.get("target", ""), "label": e.get("label", "related")}
            for e in raw_graph.get("edges", [])
            if isinstance(e, dict) and e.get("source") and e.get("target")
        ],
    )

    return UnifiedQueryResponse(
        answer=str(llm_response.get("answer", "")),
        citations=citations,
        graph=graph,
        warning=str(warning) if warning is not None else None,
    )


@app.get("/repos/{repo_id}/status", response_model=RepoStatusResponse)
def repo_status(repo_id: uuid.UUID) -> RepoStatusResponse:
    payload = _get_svc(settings.graph_service_url, "/graph/repo/status", {"repo_id": str(repo_id)})
    return RepoStatusResponse.model_validate(payload)


@app.get("/repos/{repo_id}/kg-status", response_model=KGStatusResponse)
def kg_status(repo_id: uuid.UUID) -> KGStatusResponse:
    payload = _get_svc(settings.graph_service_url, "/kg/status", {"repo_id": str(repo_id)})
    return KGStatusResponse.model_validate(payload)
