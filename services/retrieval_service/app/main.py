from __future__ import annotations

import json
import logging
import os
import random
import socket
import time
import uuid
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field


GRAPH_SERVICE_URL = os.getenv("GRAPH_SERVICE_URL", "http://graph_service:8002")
NEO4J_URL = os.getenv("NEO4J_URL") or os.getenv("NEO4J_URI") or "bolt://neo4j:7687"
ENABLE_EMBEDDINGS = os.getenv("ENABLE_EMBEDDINGS", "true").lower() not in {"0", "false", "no", "off"}
DEBUG_ENV = os.getenv("DEBUG_ENV", "false").lower() in {"1", "true", "yes", "on"}
TOP_K = int(os.getenv("TOP_K", "10"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
OPENAI_TIMEOUT_SEC = int(os.getenv("OPENAI_TIMEOUT_SEC", "30"))
OPENAI_EMBED_TIMEOUT_SEC = int(os.getenv("OPENAI_EMBED_TIMEOUT_SEC", os.getenv("OPENAI_TIMEOUT_SEC", "30")))
OPENAI_EMBED_MAX_RETRIES = max(1, int(os.getenv("OPENAI_EMBED_MAX_RETRIES", "8")))
OPENAI_EMBED_BACKOFF_BASE_SEC = float(os.getenv("OPENAI_EMBED_BACKOFF_BASE_SEC", "0.5"))
OPENAI_EMBED_BACKOFF_MAX_SEC = float(os.getenv("OPENAI_EMBED_BACKOFF_MAX_SEC", "10"))
OPENAI_EMBEDDING_DIMENSIONS = os.getenv("OPENAI_EMBEDDING_DIMENSIONS")
OPENAI_EMBED_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

app = FastAPI(title="retrieval_service")
logger = logging.getLogger("retrieval_service")
STARTUP_CONFIG_ERROR: str | None = None


class RetrieveRequest(BaseModel):
    repo_id: uuid.UUID
    question: str = Field(min_length=1)
    top_k: int | None = Field(default=None, ge=1, le=100)


class Snippet(BaseModel):
    id: str
    type: str
    name: str
    path: str
    code_snippet: str
    score: float
    semantic_score: float | None = None
    keyword_score: float | None = None


class RetrievalPack(BaseModel):
    snippets: list[Snippet]
    nodes: list[dict]
    edges: list[dict]
    scores: dict[str, dict[str, float | None]]


def _validate_embedding_startup_config() -> str | None:
    if not ENABLE_EMBEDDINGS:
        return None

    api_key = OPENAI_API_KEY.strip()
    if not api_key:
        logger.error("startup config invalid: ENABLE_EMBEDDINGS=true but OPENAI_API_KEY is missing/empty")
        return "ENABLE_EMBEDDINGS=true but OPENAI_API_KEY is missing/empty"

    if not api_key.startswith("sk-"):
        logger.warning(
            "startup config invalid: OPENAI_API_KEY format looks invalid",
            extra={"openai_api_key_present": True, "openai_api_key_length": len(api_key)},
        )
        logger.error("startup config invalid: OPENAI_API_KEY format must start with 'sk-'")
        return "ENABLE_EMBEDDINGS=true but OPENAI_API_KEY format is invalid"

    return None


def _ensure_embedding_config_ready() -> None:
    if STARTUP_CONFIG_ERROR:
        raise HTTPException(status_code=503, detail=f"embedding startup config invalid: {STARTUP_CONFIG_ERROR}")


@app.on_event("startup")
def startup() -> None:
    global STARTUP_CONFIG_ERROR
    STARTUP_CONFIG_ERROR = _validate_embedding_startup_config()


def _graph_post(path: str, payload: dict) -> dict:
    endpoint = f"{GRAPH_SERVICE_URL.rstrip('/')}{path}"
    req = urlrequest.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=OPENAI_TIMEOUT_SEC) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"graph_service {path} failed ({exc.code}): {detail}") from exc
    except urlerror.URLError as exc:
        raise HTTPException(status_code=502, detail=f"graph_service unavailable: {exc.reason}") from exc


def _graph_get(path: str, params: dict[str, str]) -> dict:
    query = urlparse.urlencode(params)
    endpoint = f"{GRAPH_SERVICE_URL.rstrip('/')}{path}?{query}"
    req = urlrequest.Request(endpoint, method="GET")
    try:
        with urlrequest.urlopen(req, timeout=OPENAI_TIMEOUT_SEC) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"graph_service {path} failed ({exc.code}): {detail}") from exc
    except urlerror.URLError as exc:
        raise HTTPException(status_code=502, detail=f"graph_service unavailable: {exc.reason}") from exc


def _openai_embed(question: str) -> list[float]:
    _ensure_embedding_config_ready()
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY is required for semantic retrieval when embeddings exist.",
        )

    payload: dict[str, object] = {
        "model": OPENAI_EMBED_MODEL,
        "input": [question],
    }
    if OPENAI_EMBEDDING_DIMENSIONS and OPENAI_EMBED_MODEL.startswith("text-embedding-3"):
        payload["dimensions"] = int(OPENAI_EMBEDDING_DIMENSIONS)

    payload_bytes = json.dumps(payload).encode("utf-8")
    data: dict | None = None
    last_error = "unknown embedding error"

    for attempt in range(1, OPENAI_EMBED_MAX_RETRIES + 1):
        req = urlrequest.Request(
            "https://api.openai.com/v1/embeddings",
            data=payload_bytes,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlrequest.urlopen(req, timeout=OPENAI_EMBED_TIMEOUT_SEC) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            break
        except urlerror.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore").strip()
            status = int(exc.code)
            last_error = f"http {status}: {detail or 'no response body'}"

            if status == 401:
                raise HTTPException(
                    status_code=401,
                    detail="OpenAI embedding unauthorized (invalid_api_key). Check OPENAI_API_KEY for retrieval_service.",
                ) from exc

            if 400 <= status < 500 and status != 429:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "OpenAI embedding request rejected with non-retryable client error "
                        f"{status}: {detail or 'no response body'}"
                    ),
                ) from exc

            if status not in OPENAI_EMBED_RETRYABLE_STATUS_CODES or attempt >= OPENAI_EMBED_MAX_RETRIES:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "OpenAI embedding failed after "
                        f"{attempt} attempt(s); last error {status}: {detail or 'no response body'}"
                    ),
                ) from exc

            capped = min(
                OPENAI_EMBED_BACKOFF_MAX_SEC,
                OPENAI_EMBED_BACKOFF_BASE_SEC * (2 ** (attempt - 1)),
            )
            sleep_sec = random.uniform(0.0, max(0.0, capped))
            logger.warning(
                "openai.embed.retry attempt=%s/%s status=%s sleep_sec=%.2f reason=%s",
                attempt,
                OPENAI_EMBED_MAX_RETRIES,
                status,
                sleep_sec,
                detail or "no response body",
            )
            time.sleep(sleep_sec)
        except (urlerror.URLError, TimeoutError, socket.timeout) as exc:
            reason = getattr(exc, "reason", exc)
            reason_text = str(reason).strip() or exc.__class__.__name__
            last_error = f"network: {reason_text}"

            if attempt >= OPENAI_EMBED_MAX_RETRIES:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "OpenAI embedding unavailable after "
                        f"{attempt} attempt(s): {reason_text}"
                    ),
                ) from exc

            capped = min(
                OPENAI_EMBED_BACKOFF_MAX_SEC,
                OPENAI_EMBED_BACKOFF_BASE_SEC * (2 ** (attempt - 1)),
            )
            sleep_sec = random.uniform(0.0, max(0.0, capped))
            logger.warning(
                "openai.embed.retry attempt=%s/%s network_error=%s sleep_sec=%.2f",
                attempt,
                OPENAI_EMBED_MAX_RETRIES,
                reason_text,
                sleep_sec,
            )
            time.sleep(sleep_sec)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"OpenAI embedding returned invalid JSON: {exc}",
            ) from exc

    if data is None:
        raise HTTPException(
            status_code=502,
            detail=(
                "OpenAI embedding failed after "
                f"{OPENAI_EMBED_MAX_RETRIES} attempt(s): {last_error}"
            ),
        )

    if not isinstance(data, dict) or "data" not in data or not data["data"]:
        raise HTTPException(status_code=502, detail="Invalid response from OpenAI embeddings API")

    embedding = data["data"][0].get("embedding", [])
    if not isinstance(embedding, list) or not embedding:
        raise HTTPException(status_code=502, detail="OpenAI embedding response missing embedding vector")
    return embedding


@app.get("/health")
async def health(response: Response) -> dict[str, object]:
    ok = STARTUP_CONFIG_ERROR is None
    if not ok:
        response.status_code = 503
    return {"ok": ok, "config_error": STARTUP_CONFIG_ERROR}


@app.get("/debug/env")
def debug_env() -> dict[str, object]:
    if not DEBUG_ENV:
        raise HTTPException(status_code=404, detail="not found")

    api_key = OPENAI_API_KEY.strip()
    return {
        "ok": True,
        "enable_embeddings": ENABLE_EMBEDDINGS,
        "neo4j_url": NEO4J_URL,
        "startup_config_ok": STARTUP_CONFIG_ERROR is None,
        "startup_config_error": STARTUP_CONFIG_ERROR,
        "openai_api_key_present": bool(api_key),
        "openai_api_key_length": len(api_key),
        "openai_api_key_prefix_valid": api_key.startswith("sk-") if api_key else False,
        "openai_embed_model": OPENAI_EMBED_MODEL,
        "openai_embed_timeout_sec": OPENAI_EMBED_TIMEOUT_SEC,
        "openai_embed_max_retries": OPENAI_EMBED_MAX_RETRIES,
    }


@app.post("/retrieve", response_model=RetrievalPack)
def retrieve(payload: RetrieveRequest) -> RetrievalPack:
    repo_id = str(payload.repo_id)
    top_k = payload.top_k or TOP_K

    keyword_hits: list[dict] = []
    try:
        keyword_response = _graph_post(
            "/graph/search/fulltext",
            {
                "repo_id": repo_id,
                "query": payload.question,
                "top_k": top_k,
            },
        )
        keyword_hits = keyword_response.get("hits", [])
    except HTTPException as exc:
        logger.warning("retrieve.fulltext_failed", extra={"repo_id": repo_id, "detail": str(exc.detail)})

    semantic_hits: list[dict] = []
    if ENABLE_EMBEDDINGS:
        try:
            status = _graph_get("/graph/embeddings/status", {"repo_id": repo_id})
            if bool(status.get("embeddings_exist")):
                query_embedding = _openai_embed(payload.question)
                semantic_response = _graph_post(
                    "/graph/search/vector",
                    {
                        "repo_id": repo_id,
                        "embedding": query_embedding,
                        "top_k": top_k,
                    },
                )
                semantic_hits = semantic_response.get("hits", [])
        except HTTPException as exc:
            logger.warning("retrieve.semantic_failed", extra={"repo_id": repo_id, "detail": str(exc.detail)})

    merged: dict[str, dict] = {}

    for hit in keyword_hits:
        node = hit.get("node", {})
        node_id = str(node.get("id", ""))
        if not node_id:
            continue
        score = float(hit.get("score", 0.0))
        entry = merged.setdefault(
            node_id,
            {
                "node": node,
                "semantic_score": None,
                "keyword_score": None,
            },
        )
        prev = entry["keyword_score"]
        if prev is None or score > prev:
            entry["keyword_score"] = score

    for hit in semantic_hits:
        node = hit.get("node", {})
        node_id = str(node.get("id", ""))
        if not node_id:
            continue
        score = float(hit.get("score", 0.0))
        entry = merged.setdefault(
            node_id,
            {
                "node": node,
                "semantic_score": None,
                "keyword_score": None,
            },
        )
        prev = entry["semantic_score"]
        if prev is None or score > prev:
            entry["semantic_score"] = score

    ranked: list[dict] = []
    for node_id, entry in merged.items():
        semantic_score = entry["semantic_score"]
        keyword_score = entry["keyword_score"]
        combined = max(
            semantic_score if semantic_score is not None else float("-inf"),
            keyword_score if keyword_score is not None else float("-inf"),
        )
        if combined == float("-inf"):
            combined = 0.0
        ranked.append(
            {
                "node_id": node_id,
                "node": entry["node"],
                "semantic_score": semantic_score,
                "keyword_score": keyword_score,
                "score": combined,
            }
        )

    ranked.sort(key=lambda item: item["score"], reverse=True)
    ranked = ranked[:top_k]

    if not ranked:
        try:
            fallback_response = _graph_post(
                "/graph/search/default",
                {
                    "repo_id": repo_id,
                    "top_k": top_k,
                },
            )
            fallback_hits = fallback_response.get("hits", [])
            for hit in fallback_hits:
                node = hit.get("node", {})
                node_id = str(node.get("id", ""))
                if not node_id:
                    continue
                score = float(hit.get("score", 0.0))
                ranked.append(
                    {
                        "node_id": node_id,
                        "node": node,
                        "semantic_score": None,
                        "keyword_score": score,
                        "score": score,
                    }
                )
            ranked.sort(key=lambda item: item["score"], reverse=True)
            ranked = ranked[:top_k]
        except HTTPException as exc:
            logger.warning("retrieve.default_fallback_failed", extra={"repo_id": repo_id, "detail": str(exc.detail)})

    selected_ids = [item["node_id"] for item in ranked]
    expanded = _graph_post(
        "/graph/expand",
        {
            "repo_id": repo_id,
            "node_ids": selected_ids,
            "hops": 1,
        },
    ) if selected_ids else {"nodes": [], "edges": []}

    snippets = [
        Snippet(
            id=str(item["node"].get("id", "")),
            type=str(item["node"].get("type", "")),
            name=str(item["node"].get("name", "")),
            path=str(item["node"].get("path", "")),
            code_snippet=str(item["node"].get("code_snippet", "")),
            score=float(item["score"]),
            semantic_score=item["semantic_score"],
            keyword_score=item["keyword_score"],
        )
        for item in ranked
    ]

    score_map = {
        item["node_id"]: {
            "semantic": item["semantic_score"],
            "keyword": item["keyword_score"],
            "combined": item["score"],
        }
        for item in ranked
    }

    return RetrievalPack(
        snippets=snippets,
        nodes=expanded.get("nodes", []),
        edges=expanded.get("edges", []),
        scores=score_map,
    )
