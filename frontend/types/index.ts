// ─────────────────────────────────────────────
// CodeGraph Navigator — Shared TypeScript types
// All shared types live here — never inline in components
// ─────────────────────────────────────────────

// ── Graph data (mirrors backend GraphNode / GraphEdge schemas) ──

export type NodeType = "Function" | "Class" | "File" | "Module";

export type EdgeType = "CALLS" | "IMPORTS" | "INHERITS" | "CONTAINS" | "HAS_METHOD";

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  file: string;
  highlighted: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  line_number?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Source references ──

export interface SourceReference {
  name: string;
  file: string;
  start_line: number;
  end_line: number;
  code: string;
  relevance_score: number;
}

// ── API request / response types ──

export interface QueryRequest {
  question: string;
  codebase_id: string;
  top_k?: number;
  hops?: number;
}

export interface QueryResponse {
  answer: string;
  sources: SourceReference[];
  graph: GraphData;
  retrieval_method: string;
  cypher_used: string | null;
}

export interface IngestRequest {
  repo_path: string;
  codebase_id: string;
  language: "python";
}

export interface IngestResponse {
  status: string;
  nodes_created: number;
  relationships_created: number;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── UI state types ──

export type AppState = "empty" | "loading" | "results";

export interface IngestProgress {
  step: string;
  status: "pending" | "running" | "done" | "error";
  count?: number;
  total?: number;
}
