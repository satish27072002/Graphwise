from __future__ import annotations

from typing import Any
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobCreatedResponse(BaseModel):
    job_id: uuid.UUID
    repo_id: uuid.UUID


class JobStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: uuid.UUID
    repo_id: uuid.UUID
    job_type: str
    status: str
    progress: int
    current_step: str
    attempts: int
    error: str | None
    created_at: datetime
    updated_at: datetime


class QueryRequest(BaseModel):
    repo_id: uuid.UUID
    question: str


class GraphNode(BaseModel):
    id: str
    type: str
    label: str
    path: str | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str


class GraphPayload(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class UnifiedQueryResponse(BaseModel):
    answer: str
    citations: list[str]
    graph: GraphPayload
    warning: str | None = None


class RepoStatusResponse(BaseModel):
    repo_id: uuid.UUID
    indexed_node_count: int
    indexed_edge_count: int
    embedded_nodes: int
    embeddings_exist: bool


class KGStatusResponse(BaseModel):
    docs: int
    chunks: int
    entities: int
    relations: int
    embedded_chunks: int
    embedded_entities: int
