// ─────────────────────────────────────────────
// All API calls go through this module.
// Never call fetch directly in components.
// ─────────────────────────────────────────────

import type {
  QueryRequest,
  QueryResponse,
  IngestRequest,
  IngestResponse,
  GraphResponse,
} from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API error ${res.status}: ${error}`);
  }

  return res.json() as Promise<T>;
}

// POST /query
export async function queryCodebase(request: QueryRequest): Promise<QueryResponse> {
  return fetchJSON<QueryResponse>("/query", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// POST /ingest
export async function ingestCodebase(request: IngestRequest): Promise<IngestResponse> {
  return fetchJSON<IngestResponse>("/ingest", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// GET /graph/{node_id}
export async function getNodeGraph(nodeId: string): Promise<GraphResponse> {
  return fetchJSON<GraphResponse>(`/graph/${encodeURIComponent(nodeId)}`);
}

// GET /health
export async function checkHealth(): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>("/health");
}
