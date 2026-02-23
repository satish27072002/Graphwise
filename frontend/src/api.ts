import { JobStatus } from "./types";

export type { JobStatus };

export interface Job {
  job_id: string;
  repo_id: string;
  job_type: string;
  status: JobStatus;
  progress: number;
  current_step: string;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  path?: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface UnifiedQueryResult {
  answer: string;
  citations: string[];
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  warning?: string | null;
}

function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE as string | undefined;
  if (configured && configured.trim()) return configured.trim();
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
}

const API_BASE = resolveApiBase();

function normalize(path: string): string {
  const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(normalize(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

export function health() {
  return request<{ ok: boolean }>("/health");
}

export async function ingestZip(file: File) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(normalize("/ingest/zip"), {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }

  return (await res.json()) as { job_id: string; repo_id: string };
}

export function getJob(jobId: string) {
  return request<Job>(`/jobs/${jobId}`);
}

export function listJobs(repoId: string) {
  return request<Job[]>(`/jobs?repo_id=${encodeURIComponent(repoId)}`);
}

export function repoStatus(repoId: string) {
  return request<{
    repo_id: string;
    indexed_node_count: number;
    indexed_edge_count: number;
    embedded_nodes: number;
    embeddings_exist: boolean;
  }>(`/repos/${repoId}/status`);
}

export function queryRepo(repoId: string, question: string) {
  return request<UnifiedQueryResult>("/query", {
    method: "POST",
    body: JSON.stringify({ repo_id: repoId, question }),
  });
}
