"""
POST /ingest — Parse a local codebase, extract functions/classes/imports/calls,
build the Neo4j knowledge graph, generate embeddings, and create indexes.
"""

import logging
from fastapi import APIRouter, HTTPException

from models.schemas import IngestRequest, IngestResponse
from services.parser.python_parser import parse_repository
from services.graph.builder import build_graph
from services.graph.neo4j_loader import load_graph, delete_codebase
from services.embeddings.embedder import embed_nodes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("", response_model=IngestResponse)
async def ingest(request: IngestRequest) -> IngestResponse:
    """
    Ingest a Python codebase and build the Neo4j knowledge graph.

    Steps:
      1. Parse all .py files with tree-sitter
      2. Build graph (normalize nodes + relationships)
      3. Generate OpenAI embeddings for Function nodes
      4. Load everything into Neo4j (MERGE — safe re-ingestion)
    """
    logger.info(f"Ingest started: codebase_id={request.codebase_id}, path={request.repo_path}")

    # ── Step 1: Parse ──────────────────────────────────────────────────
    try:
        parsed = parse_repository(request.repo_path, request.codebase_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("Parsing failed")
        raise HTTPException(status_code=500, detail=f"Parsing error: {exc}")

    if parsed["stats"]["files_parsed"] == 0:
        raise HTTPException(
            status_code=422,
            detail=f"No Python files found in '{request.repo_path}'",
        )

    # ── Step 2: Build graph ────────────────────────────────────────────
    graph_data = build_graph(parsed, request.codebase_id)

    # ── Step 3: Embed Function nodes ───────────────────────────────────
    try:
        graph_data["nodes"] = await embed_nodes(graph_data["nodes"])
    except Exception as exc:
        logger.warning(f"Embedding failed (continuing without embeddings): {exc}")
        # Non-fatal: ingest proceeds, hybrid search will fall back to full-text only

    # ── Step 4: Load into Neo4j ────────────────────────────────────────
    try:
        result = await load_graph(graph_data["nodes"], graph_data["relationships"])
    except Exception as exc:
        logger.exception("Neo4j load failed")
        raise HTTPException(status_code=500, detail=f"Neo4j load error: {exc}")

    logger.info(
        f"Ingest complete: {result['nodes_created']} nodes, "
        f"{result['relationships_created']} relationships"
    )

    return IngestResponse(
        status="ok",
        nodes_created=result["nodes_created"],
        relationships_created=result["relationships_created"],
    )
