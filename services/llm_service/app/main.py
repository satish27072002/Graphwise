from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
OPENAI_TIMEOUT_SEC = int(os.getenv("OPENAI_TIMEOUT_SEC", "30"))
NEO4J_URL = os.getenv("NEO4J_URL") or os.getenv("NEO4J_URI") or "bolt://neo4j:7687"
MAX_CONTEXT_SNIPPETS = int(os.getenv("MAX_CONTEXT_SNIPPETS", "8"))
MAX_SNIPPET_CHARS = int(os.getenv("MAX_LLM_SNIPPET_CHARS", "1200"))
MAX_GRAPH_EDGES_FOR_PROMPT = int(os.getenv("MAX_GRAPH_EDGES_FOR_PROMPT", "40"))

app = FastAPI(title="llm_service")


class AnswerRequest(BaseModel):
    repo_id: uuid.UUID
    question: str = Field(min_length=1)
    retrieval_pack: dict[str, Any]


class AnswerResponse(BaseModel):
    answer: str
    citations: list[str]
    warning: str | None = None


def _sorted_snippets(retrieval_pack: dict[str, Any]) -> list[dict[str, Any]]:
    snippets = retrieval_pack.get("snippets", [])
    if not isinstance(snippets, list):
        return []

    normalized: list[dict[str, Any]] = []
    for raw in snippets:
        if not isinstance(raw, dict):
            continue
        snippet_id = str(raw.get("id", "")).strip()
        if not snippet_id:
            continue
        normalized.append(
            {
                "id": snippet_id,
                "name": str(raw.get("name", "")),
                "path": str(raw.get("path", "")),
                "type": str(raw.get("type", "")),
                "code_snippet": str(raw.get("code_snippet", "")),
                "score": float(raw.get("score", 0.0) or 0.0),
            }
        )

    normalized.sort(key=lambda item: item["score"], reverse=True)
    return normalized


def _fallback_answer(question: str, retrieval_pack: dict[str, Any]) -> AnswerResponse:
    snippets = _sorted_snippets(retrieval_pack)[:MAX_CONTEXT_SNIPPETS]
    nodes = _normalized_nodes(retrieval_pack)
    if not snippets and not nodes:
        return AnswerResponse(
            answer=(
                "No indexed snippets were retrieved for this repository yet. "
                "Run ingest/indexing and retry the query."
            ),
            citations=[],
            warning="OPENAI_API_KEY missing; returned deterministic fallback answer.",
        )

    answer = _deterministic_summary_answer(question, retrieval_pack, snippets)
    citations = [snippet["id"] for snippet in snippets[:5]]
    return AnswerResponse(
        answer=answer,
        citations=citations,
        warning="OPENAI_API_KEY missing; returned deterministic fallback answer.",
    )


def _build_context(snippets: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for snippet in snippets[:MAX_CONTEXT_SNIPPETS]:
        code = snippet["code_snippet"][:MAX_SNIPPET_CHARS]
        chunks.append(
            "\n".join(
                [
                    f"id: {snippet['id']}",
                    f"path: {snippet['path']}",
                    f"name: {snippet['name']}",
                    f"type: {snippet['type']}",
                    f"score: {snippet['score']}",
                    "snippet:",
                    code,
                ]
            )
        )
    return "\n\n---\n\n".join(chunks)


def _extract_ids(text: str, allowed: set[str]) -> list[str]:
    ids: list[str] = []
    for token in re.findall(r"[a-f0-9]{32,64}", text.lower()):
        if token in allowed and token not in ids:
            ids.append(token)
    return ids


def _normalized_nodes(retrieval_pack: dict[str, Any]) -> list[dict[str, str]]:
    nodes = retrieval_pack.get("nodes", [])
    if not isinstance(nodes, list):
        return []

    normalized: list[dict[str, str]] = []
    for raw in nodes:
        if not isinstance(raw, dict):
            continue
        node_id = str(raw.get("id", "")).strip()
        if not node_id:
            continue
        normalized.append(
            {
                "id": node_id,
                "name": str(raw.get("name", "")).strip(),
                "type": str(raw.get("type", "")).strip(),
                "path": str(raw.get("path", "")).strip(),
            }
        )
    return normalized


def _normalized_edges(retrieval_pack: dict[str, Any]) -> list[dict[str, str]]:
    edges = retrieval_pack.get("edges", [])
    if not isinstance(edges, list):
        return []

    normalized: list[dict[str, str]] = []
    for raw in edges:
        if not isinstance(raw, dict):
            continue
        source = str(raw.get("source", "")).strip()
        target = str(raw.get("target", "")).strip()
        if not source or not target:
            continue
        normalized.append(
            {
                "source": source,
                "target": target,
                "type": str(raw.get("type", "")).strip().lower() or "related_to",
            }
        )
    return normalized


def _graph_context_summary(retrieval_pack: dict[str, Any]) -> str:
    nodes = _normalized_nodes(retrieval_pack)
    edges = _normalized_edges(retrieval_pack)
    if not nodes and not edges:
        return "No graph neighborhood data available."

    node_by_id = {node["id"]: node for node in nodes}
    type_counts: dict[str, int] = {}
    for node in nodes:
        node_type = node["type"] or "unknown"
        type_counts[node_type] = type_counts.get(node_type, 0) + 1

    top_types = ", ".join(
        f"{node_type}:{count}"
        for node_type, count in sorted(type_counts.items(), key=lambda item: item[1], reverse=True)[:4]
    ) or "n/a"

    edge_lines: list[str] = []
    for edge in edges[:MAX_GRAPH_EDGES_FOR_PROMPT]:
        source = node_by_id.get(edge["source"], {"name": edge["source"]})
        target = node_by_id.get(edge["target"], {"name": edge["target"]})
        edge_lines.append(f"{source['name']} -[{edge['type']}]-> {target['name']}")

    lines = [
        f"Graph nodes: {len(nodes)}",
        f"Graph edges: {len(edges)}",
        f"Node types: {top_types}",
    ]
    if edge_lines:
        lines.append("Key relationships:")
        lines.extend(edge_lines)
    return "\n".join(lines)


def _deterministic_summary_answer(
    question: str,
    retrieval_pack: dict[str, Any],
    snippets: list[dict[str, Any]] | None = None,
) -> str:
    chosen = snippets if snippets is not None else _sorted_snippets(retrieval_pack)[:MAX_CONTEXT_SNIPPETS]
    nodes = _normalized_nodes(retrieval_pack)
    edges = _normalized_edges(retrieval_pack)

    if not chosen and not nodes:
        return (
            "No indexed snippets were retrieved for this repository yet. "
            "Run ingest/indexing and retry the query."
        )

    highlights: list[str] = []
    for snippet in chosen[:4]:
        highlights.append(
            f"- {snippet['name']} ({snippet['path'] or '<no path>'}) [{snippet['type']}] score={snippet['score']:.3f}"
        )

    relation_lines: list[str] = []
    node_by_id = {node["id"]: node for node in nodes}
    for edge in edges[:6]:
        source_name = node_by_id.get(edge["source"], {"name": edge["source"]})["name"]
        target_name = node_by_id.get(edge["target"], {"name": edge["target"]})["name"]
        relation_lines.append(f"- {source_name} --{edge['type']}--> {target_name}")

    lines = [f"Best-effort answer for: {question}"]
    if highlights:
        lines.append("Most relevant code anchors:")
        lines.extend(highlights)
    if relation_lines:
        lines.append("Observed graph relationships:")
        lines.extend(relation_lines)
    lines.append(
        f"Retrieved context size: snippets={len(chosen)}, nodes={len(nodes)}, edges={len(edges)}."
    )
    return "\n".join(lines)


def _looks_low_confidence(answer: str) -> bool:
    text = answer.strip().lower()
    if not text:
        return True
    weak_markers = (
        "i'm unsure",
        "i am unsure",
        "not enough context",
        "cannot determine",
        "no context",
        "can't determine",
    )
    return any(marker in text for marker in weak_markers)


def _openai_answer(question: str, retrieval_pack: dict[str, Any]) -> AnswerResponse:
    snippets = _sorted_snippets(retrieval_pack)[:MAX_CONTEXT_SNIPPETS]
    context = _build_context(snippets)
    graph_context = _graph_context_summary(retrieval_pack)
    allowed_ids = {snippet["id"] for snippet in snippets}

    prompt = (
        "You are answering repository questions using retrieved code and graph context. "
        "Return strict JSON with keys: answer (string) and citations (array of snippet ids). "
        "Only cite ids from the provided context. "
        "When context exists, give a best-effort explanation instead of saying there is no context.\n\n"
        f"Question:\n{question}\n\n"
        f"Context snippets:\n{context}\n"
        f"\nGraph context:\n{graph_context}\n"
    )

    payload = {
        "model": OPENAI_CHAT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Be concise, factual, and cite provided snippet ids. "
                    "Answer with practical explanation: repository purpose, key components, and how components connect. "
                    "Never claim there is no context when snippets or graph relationships are present."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }

    req = urlrequest.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlrequest.urlopen(req, timeout=OPENAI_TIMEOUT_SEC) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"OpenAI LLM call failed ({exc.code}): {detail}") from exc
    except urlerror.URLError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI LLM unavailable: {exc.reason}") from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Invalid OpenAI LLM response payload") from exc

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        parsed = {"answer": str(content), "citations": _extract_ids(str(content), allowed_ids)}

    answer = str(parsed.get("answer", "")).strip() or "No answer generated."
    citations_raw = parsed.get("citations", [])
    citations: list[str] = []
    if isinstance(citations_raw, list):
        for item in citations_raw:
            token = str(item).strip().lower()
            if token in allowed_ids and token not in citations:
                citations.append(token)

    if not citations:
        for snippet in snippets[:3]:
            citations.append(snippet["id"])

    warning: str | None = None
    if snippets and _looks_low_confidence(answer):
        deterministic = _deterministic_summary_answer(question, retrieval_pack, snippets)
        answer = f"{deterministic}\n\nModel response note:\n{answer}"
        warning = "LLM returned low-confidence wording; appended deterministic retrieval summary."

    return AnswerResponse(answer=answer, citations=citations, warning=warning)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/answer", response_model=AnswerResponse)
def answer(payload: AnswerRequest) -> AnswerResponse:
    if not OPENAI_API_KEY:
        return _fallback_answer(payload.question, payload.retrieval_pack)
    return _openai_answer(payload.question, payload.retrieval_pack)
