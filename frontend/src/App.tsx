import { useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getJob,
  health,
  ingestZip,
  listJobs,
  queryRepo,
  repoStatus,
  type Job,
  type QueryResult,
  type RetrievalEdge,
  type RetrievalNode,
  type RetrievalSnippet,
} from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Point = {
  x: number;
  y: number;
};

type GraphLayout = {
  width: number;
  height: number;
  focusId: string | null;
  nodes: RetrievalNode[];
  edges: RetrievalEdge[];
  positions: Map<string, Point>;
  nodeById: Map<string, RetrievalNode>;
};

function useLocalStorageState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return initialValue;
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  const setAndStore: Dispatch<SetStateAction<T>> = (next) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? (next as (old: T) => T)(prev) : next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      }
      return resolved;
    });
  };

  return [value, setAndStore] as const;
}

function formatTime(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function truncate(text: string, max = 72): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div className="app-bg">
      <div className="app-grid" />
      <header className="topbar">
        <div>
          <p className="eyebrow">CodeGraph Control Plane</p>
          <h1>Repository Intelligence Console</h1>
        </div>
        <nav>
          <Link className={location.pathname === "/dashboard" ? "active" : ""} to="/dashboard">
            Dashboard
          </Link>
          <Link className={location.pathname === "/jobs" ? "active" : ""} to="/jobs">
            Jobs
          </Link>
        </nav>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

function Dashboard() {
  const [repoId, setRepoId] = useLocalStorageState("cg.repo_id", "");
  const [jobId, setJobId] = useLocalStorageState("cg.job_id", "");
  const [question, setQuestion] = useLocalStorageState("cg.question", "What does this repository do?");
  const [zipHintName, setZipHintName] = useLocalStorageState("cg.zip_hint_name", "");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const healthQ = useQuery({ queryKey: ["health"], queryFn: health, refetchInterval: 5000 });

  const jobQ = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const data = q.state.data as Job | undefined;
      if (!data) return 3000;
      return data.status === "completed" || data.status === "failed" ? false : 3000;
    },
  });

  const jobsQ = useQuery({
    queryKey: ["jobs", repoId],
    queryFn: () => listJobs(repoId),
    enabled: Boolean(repoId),
    refetchInterval: 5000,
  });

  const repoStatusQ = useQuery({
    queryKey: ["repo-status", repoId],
    queryFn: () => repoStatus(repoId),
    enabled: Boolean(repoId),
    refetchInterval: 8000,
  });

  const ingestZipM = useMutation({
    mutationFn: () => {
      const current = zipInputRef.current?.files?.[0] ?? zipFile;
      if (!current) throw new Error("Choose a .zip file first");
      return ingestZip(current);
    },
    onSuccess: (result) => {
      setRepoId(result.repo_id);
      setJobId(result.job_id);
      setZipFile(null);
      if (zipInputRef.current) {
        zipInputRef.current.value = "";
      }
    },
  });

  const queryM = useMutation({
    mutationFn: () => {
      const normalizedRepo = repoId.trim();
      const normalizedQuestion = question.trim();
      if (!normalizedRepo) throw new Error("Provide a repo id");
      if (!normalizedQuestion) throw new Error("Provide a question");
      return queryRepo(normalizedRepo, normalizedQuestion);
    },
  });

  const running = useMemo(() => {
    const jobs = jobsQ.data ?? [];
    return jobs.filter((j) => j.status === "running").length;
  }, [jobsQ.data]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="stack">
      <section className="cards cards-3">
        <article className="card stat">
          <h3>Gateway</h3>
          <p className={healthQ.data?.ok ? "ok" : "bad"}>{healthQ.data?.ok ? "Healthy" : "Down"}</p>
        </article>
        <article className="card stat">
          <h3>Running Jobs</h3>
          <p>{running}</p>
        </article>
        <article className="card stat">
          <h3>Current Repo</h3>
          <p>{repoId || "-"}</p>
        </article>
      </section>

      <section className="card">
        <form
          className="stack compact"
          onSubmit={(e) => {
            e.preventDefault();
            ingestZipM.mutate();
          }}
        >
          <h2>Ingest ZIP</h2>
          <label>
            Upload .zip
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setZipFile(next);
                setZipHintName(next?.name || "");
              }}
              required
            />
          </label>
          {!zipFile && zipHintName && (
            <p className="muted small">
              Previously selected file: {zipHintName}. Please choose it again before uploading.
            </p>
          )}
          <Button disabled={ingestZipM.isPending}>{ingestZipM.isPending ? "Uploading..." : "Start ZIP Ingest"}</Button>
          {ingestZipM.error && <p className="error">{(ingestZipM.error as Error).message}</p>}
        </form>
      </section>

      <section className="cards cards-2">
        <article className="card">
          <h2>Current Job</h2>
          <label>
            Job ID
            <Input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="job UUID" />
          </label>
          {jobQ.data && (
            <div className="job-details">
              <p>
                Status: <strong>{jobQ.data.status}</strong>
              </p>
              <p>
                Progress: <strong>{jobQ.data.progress}%</strong>
              </p>
              <p>
                Step: <strong>{jobQ.data.current_step}</strong>
              </p>
              <p>Updated: {formatTime(jobQ.data.updated_at)}</p>
              {jobQ.data.error && <p className="error">{jobQ.data.error}</p>}
            </div>
          )}
        </article>

        <article className="card">
          <h2>Repo Status</h2>
          <label>
            Repo ID
            <Input value={repoId} onChange={(e) => setRepoId(e.target.value)} placeholder="repo UUID" />
          </label>
          {repoStatusQ.data && (
            <div className="job-details">
              <p>
                Indexed Nodes: <strong>{repoStatusQ.data.indexed_node_count}</strong>
              </p>
              <p>
                Indexed Edges: <strong>{repoStatusQ.data.indexed_edge_count}</strong>
              </p>
              <p>
                Embedded Nodes: <strong>{repoStatusQ.data.embedded_nodes}</strong>
              </p>
              <p>
                Embeddings: <strong>{repoStatusQ.data.embeddings_exist ? "Yes" : "No"}</strong>
              </p>
            </div>
          )}
        </article>
      </section>

      <section className="card">
        <h2>Query</h2>
        <label>
          Question
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} />
        </label>
        <Button onClick={() => queryM.mutate()} disabled={queryM.isPending}>
          {queryM.isPending ? "Querying..." : "Run Query"}
        </Button>
        {queryM.error && <p className="error">{(queryM.error as Error).message}</p>}
        {queryM.data && <QueryResultPanel data={queryM.data} question={question} />}
      </section>
    </motion.div>
  );
}

function summarizeContext(question: string, snippets: RetrievalSnippet[], nodes: RetrievalNode[], edges: RetrievalEdge[]): string {
  if (!snippets.length && !nodes.length) {
    return `No retrieval context was found for "${question}". Try a more specific question with concrete symbols, file names, or module names.`;
  }

  const byType = new Map<string, number>();
  for (const node of nodes) {
    byType.set(node.type, (byType.get(node.type) ?? 0) + 1);
  }
  const typeSummary = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");

  const top = snippets
    .slice(0, 3)
    .map((s) => `${s.name} (${s.path || "<unknown path>"})`)
    .join("; ");

  const graphSummary = `${nodes.length} nodes and ${edges.length} edges in the neighborhood graph.`;
  if (!top) {
    return `Retrieved graph context for "${question}": ${graphSummary} Dominant node types: ${typeSummary || "n/a"}.`;
  }
  return `For "${question}", the strongest code anchors are ${top}. Retrieved ${graphSummary} Dominant node types: ${typeSummary || "n/a"}.`;
}

function nodeColor(type: string): string {
  switch (type) {
    case "file":
      return "#3fa9ff";
    case "class":
      return "#ff9b57";
    case "function":
      return "#52e0b6";
    case "module":
      return "#b083ff";
    default:
      return "#9fb2d6";
  }
}

function edgeColor(type: string): string {
  switch (type) {
    case "contains":
      return "#6ec6ff";
    case "imports":
      return "#ca98ff";
    case "calls":
      return "#63efbb";
    default:
      return "#5c7aa5";
  }
}

function nodeTypeRank(type: string): number {
  switch (type) {
    case "file":
      return 0;
    case "function":
      return 1;
    case "class":
      return 2;
    case "module":
      return 3;
    default:
      return 4;
  }
}

function relationRank(type: string): number {
  switch (type) {
    case "contains":
      return 0;
    case "calls":
      return 1;
    case "imports":
      return 2;
    default:
      return 3;
  }
}

function relationHeading(type: string): string {
  switch (type) {
    case "contains":
      return "Structure (contains)";
    case "calls":
      return "Behavior (calls)";
    case "imports":
      return "Dependencies (imports)";
    default:
      return "Other links";
  }
}

type AnswerMapEdge = {
  source: string;
  target: string;
  type: string;
  direction: "in" | "out";
  otherId: string;
};

function pickFocusNode(
  nodes: RetrievalNode[],
  snippets: RetrievalSnippet[],
  citations: string[],
  nodeById: Map<string, RetrievalNode>,
): RetrievalNode | null {
  const citationNodes = citations.map((id) => nodeById.get(id)).filter(Boolean) as RetrievalNode[];
  citationNodes.sort((a, b) => nodeTypeRank(a.type) - nodeTypeRank(b.type));
  if (citationNodes.length) return citationNodes[0];

  const snippetNodes = snippets.map((s) => nodeById.get(s.id)).filter(Boolean) as RetrievalNode[];
  snippetNodes.sort((a, b) => nodeTypeRank(a.type) - nodeTypeRank(b.type));
  if (snippetNodes.length) return snippetNodes[0];

  if (!nodes.length) return null;
  const sorted = [...nodes].sort((a, b) => nodeTypeRank(a.type) - nodeTypeRank(b.type));
  return sorted[0];
}

function buildAnswerMapEdges(focusId: string, edges: RetrievalEdge[], nodeById: Map<string, RetrievalNode>): AnswerMapEdge[] {
  const best = new Map<string, AnswerMapEdge>();
  for (const edge of edges) {
    if (edge.source !== focusId && edge.target !== focusId) continue;
    const direction = edge.source === focusId ? "out" : "in";
    const otherId = edge.source === focusId ? edge.target : edge.source;
    if (!nodeById.has(otherId)) continue;
    const key = `${otherId}:${edge.type}:${direction}`;
    const candidate: AnswerMapEdge = {
      source: edge.source,
      target: edge.target,
      type: edge.type,
      direction,
      otherId,
    };
    const prev = best.get(key);
    if (!prev || relationRank(candidate.type) < relationRank(prev.type)) {
      best.set(key, candidate);
    }
  }
  return Array.from(best.values()).sort((a, b) => relationRank(a.type) - relationRank(b.type)).slice(0, 12);
}

function AnswerExplanationPanel({
  question,
  snippets,
  nodes,
  edges,
  citations,
}: {
  question: string;
  snippets: RetrievalSnippet[];
  nodes: RetrievalNode[];
  edges: RetrievalEdge[];
  citations: string[];
}) {
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const focusNode = useMemo(() => pickFocusNode(nodes, snippets, citations, nodeById), [nodes, snippets, citations, nodeById]);
  const mapEdges = useMemo(
    () => (focusNode ? buildAnswerMapEdges(focusNode.id, edges, nodeById) : []),
    [focusNode, edges, nodeById],
  );
  const grouped = useMemo(() => {
    const buckets: Record<string, AnswerMapEdge[]> = {
      contains: [],
      calls: [],
      imports: [],
      other: [],
    };
    for (const edge of mapEdges) {
      if (edge.type === "contains" || edge.type === "calls" || edge.type === "imports") {
        buckets[edge.type].push(edge);
      } else {
        buckets.other.push(edge);
      }
    }
    return buckets;
  }, [mapEdges]);

  if (!focusNode) {
    return <p className="muted">No retrieval graph available yet for visual explanation.</p>;
  }

  return (
    <div className="answer-map">
      <div className="flow-strip">
        <article className="flow-card question">
          <span>Question</span>
          <p>{question}</p>
        </article>
        <div className="flow-arrow">→</div>
        <article className="flow-card focus">
          <span>Primary Code Anchor</span>
          <h5>{focusNode.name || focusNode.id}</h5>
          <p>{focusNode.path || "<external>"}</p>
        </article>
        <div className="flow-arrow">→</div>
        <article className="flow-card outcome">
          <span>Answer Basis</span>
          <p>
            {mapEdges.length} direct relationships and {snippets.length} snippets support this answer.
          </p>
        </article>
      </div>

      <div className="evidence-list">
        <h5>Top Evidence</h5>
        <div className="evidence-grid">
          {snippets.slice(0, 3).map((snippet) => (
            <article key={snippet.id} className="evidence-item">
              <p className="muted small">{snippet.type}</p>
              <h6>{snippet.name || snippet.id}</h6>
              <p className="muted small">{snippet.path || "<external>"}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="relation-grid">
        {(["contains", "calls", "imports", "other"] as const).map((type) => (
          <section key={type} className="relation-card">
            <h5>{relationHeading(type)}</h5>
            {grouped[type].length ? (
              <ul>
                {grouped[type].map((edge, idx) => {
                  const sourceName = nodeById.get(edge.source)?.name || edge.source;
                  const targetName = nodeById.get(edge.target)?.name || edge.target;
                  return (
                    <li key={`${edge.source}-${edge.target}-${edge.type}-${idx}`}>
                      <span>{truncate(sourceName, 28)}</span>
                      <strong className={`edge-pill ${edge.type}`}>{edge.type.toUpperCase()}</strong>
                      <span>{truncate(targetName, 28)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted small">No direct {type} links from the primary anchor.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function buildGraphLayout(
  nodes: RetrievalNode[],
  edges: RetrievalEdge[],
  snippets: RetrievalSnippet[],
  citations: string[],
  selectedId: string | null,
): GraphLayout {
  const limitedNodes = nodes.slice(0, 120);
  const nodeById = new Map<string, RetrievalNode>(limitedNodes.map((node) => [node.id, node]));
  const filteredEdges = edges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
    .slice(0, 260);

  const adjacency = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  for (const node of limitedNodes) {
    adjacency.set(node.id, new Set<string>());
    degree.set(node.id, 0);
  }

  for (const edge of filteredEdges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const citationFocus = citations.find((id) => nodeById.has(id)) ?? null;
  const snippetFocus = snippets.find((s) => nodeById.has(s.id))?.id ?? null;
  const focusId =
    (selectedId && nodeById.has(selectedId) ? selectedId : null) ?? citationFocus ?? snippetFocus ?? limitedNodes[0]?.id ?? null;

  const positions = new Map<string, Point>();
  const width = 980;
  const height = 430;
  const centerX = width / 2;
  const centerY = height / 2 - 10;

  if (!focusId) {
    return {
      width,
      height,
      focusId: null,
      nodes: limitedNodes,
      edges: filteredEdges,
      positions,
      nodeById,
    };
  }

  const depth = new Map<string, number>();
  const queue: string[] = [focusId];
  depth.set(focusId, 0);

  while (queue.length) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current) ?? 0;
    if (currentDepth >= 3) continue;
    for (const next of adjacency.get(current) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
  }

  const connectedIds = new Set(Array.from(depth.keys()));
  const disconnected = limitedNodes
    .filter((node) => !connectedIds.has(node.id))
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, 20);

  const displayedIds = new Set<string>([...connectedIds, ...disconnected.map((node) => node.id)]);
  const displayedNodes = limitedNodes.filter((node) => displayedIds.has(node.id));
  const displayedEdges = filteredEdges.filter((edge) => displayedIds.has(edge.source) && displayedIds.has(edge.target));

  const byDepth = new Map<number, RetrievalNode[]>();
  for (const node of displayedNodes) {
    const d = depth.get(node.id);
    if (d === undefined) continue;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(node);
  }

  positions.set(focusId, { x: centerX, y: centerY });
  const maxDepth = Math.max(0, ...Array.from(byDepth.keys()));

  for (let d = 1; d <= maxDepth; d += 1) {
    const group = (byDepth.get(d) ?? []).sort((a, b) => {
      const degreeDelta = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
      if (degreeDelta !== 0) return degreeDelta;
      return a.name.localeCompare(b.name);
    });
    if (!group.length) continue;

    const radius = 95 * d;
    const step = (Math.PI * 2) / group.length;
    const start = d % 2 === 0 ? Math.PI / 10 : 0;
    group.forEach((node, i) => {
      positions.set(node.id, {
        x: centerX + Math.cos(start + step * i) * radius,
        y: centerY + Math.sin(start + step * i) * radius,
      });
    });
  }

  if (disconnected.length) {
    const padding = 30;
    const spread = Math.max(width - padding * 2, 1);
    disconnected.forEach((node, idx) => {
      const x = padding + (spread * (idx + 0.5)) / disconnected.length;
      const y = height - 28;
      positions.set(node.id, { x, y });
    });
  }

  return {
    width,
    height,
    focusId,
    nodes: displayedNodes,
    edges: displayedEdges,
    positions,
    nodeById,
  };
}

function GraphPanel({
  nodes,
  edges,
  snippets,
  citations,
}: {
  nodes: RetrievalNode[];
  edges: RetrievalEdge[];
  snippets: RetrievalSnippet[];
  citations: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const snippetById = useMemo(() => {
    const map = new Map<string, RetrievalSnippet>();
    for (const s of snippets) map.set(s.id, s);
    return map;
  }, [snippets]);

  const layout = useMemo(
    () => buildGraphLayout(nodes, edges, snippets, citations, selectedId),
    [nodes, edges, snippets, citations, selectedId],
  );

  const activeId = selectedId && layout.positions.has(selectedId) ? selectedId : layout.focusId;
  const selectedNode = activeId ? layout.nodeById.get(activeId) ?? null : null;
  const selectedSnippet = selectedNode ? snippetById.get(selectedNode.id) : undefined;

  const connectedEdges = useMemo(() => {
    if (!activeId) return layout.edges.slice(0, 20);
    return layout.edges
      .filter((edge) => edge.source === activeId || edge.target === activeId)
      .slice(0, 24);
  }, [layout.edges, activeId]);

  if (!layout.nodes.length) {
    return <p className="muted">No nodes in retrieval pack yet.</p>;
  }

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="graph-svg" role="img" aria-label="retrieval graph">
        <defs>
          <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#98b4df" />
          </marker>
        </defs>

        {layout.edges.map((edge, i) => {
          const source = layout.positions.get(edge.source);
          const target = layout.positions.get(edge.target);
          if (!source || !target) return null;
          const isActive = activeId && (edge.source === activeId || edge.target === activeId);
          return (
            <line
              key={`${edge.source}-${edge.target}-${i}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={isActive ? edgeColor(edge.type) : "#38547f"}
              strokeWidth={isActive ? 2.8 : 1.4}
              opacity={isActive ? 0.95 : 0.55}
              markerEnd="url(#graph-arrow)"
            />
          );
        })}

        {layout.nodes.map((node) => {
          const point = layout.positions.get(node.id);
          if (!point) return null;
          const active = activeId === node.id;
          return (
            <g key={node.id} onClick={() => setSelectedId(node.id)} className="graph-node-group">
              <circle
                cx={point.x}
                cy={point.y}
                r={active ? 11 : 8}
                fill={nodeColor(node.type)}
                stroke={active ? "#eaf8ff" : "#11223f"}
                strokeWidth={active ? 2.5 : 1.2}
              />
              <text x={point.x + 12} y={point.y + 4} className="graph-label">
                {truncate(node.name || node.id, 24)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="legend-row">
        {["file", "class", "function", "module", "other"].map((type) => (
          <span key={type} className="legend-item">
            <i style={{ background: nodeColor(type) }} /> {type}
          </span>
        ))}
        {["contains", "imports", "calls"].map((type) => (
          <span key={type} className="legend-item edge-kind">
            <i style={{ background: edgeColor(type) }} /> {type}
          </span>
        ))}
      </div>

      {connectedEdges.length > 0 && (
        <div className="edge-list">
          <h5>{activeId ? "Connected Edges" : "Top Edges"}</h5>
          <ul>
            {connectedEdges.map((edge, idx) => {
              const sourceName = layout.nodeById.get(edge.source)?.name || edge.source;
              const targetName = layout.nodeById.get(edge.target)?.name || edge.target;
              return (
                <li key={`${edge.source}-${edge.target}-${edge.type}-${idx}`}>
                  <span>{truncate(sourceName, 28)}</span>
                  <strong>{edge.type}</strong>
                  <span>{truncate(targetName, 28)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selectedNode && (
        <div className="node-drawer">
          <h4>{selectedNode.name || selectedNode.id}</h4>
          <p className="muted small">
            type={selectedNode.type} · path={selectedNode.path || "<n/a>"}
          </p>
          <pre>{(selectedSnippet?.code_snippet || selectedNode.code_snippet || "").slice(0, 1600) || "No snippet available."}</pre>
        </div>
      )}
    </div>
  );
}

function QueryResultPanel({ data, question }: { data: QueryResult; question: string }) {
  const [showDetailedGraph, setShowDetailedGraph] = useState(false);
  const snippets = data.retrieval_pack?.snippets ?? [];
  const nodes = data.retrieval_pack?.nodes ?? [];
  const edges = data.retrieval_pack?.edges ?? [];
  const insight = summarizeContext(question, snippets, nodes, edges);

  return (
    <div className="result-box">
      <h3>Answer</h3>
      <p>{data.answer || "No answer returned."}</p>
      {data.warning && <p className="warning">{data.warning}</p>}

      <h4>Context Explanation</h4>
      <p>{insight}</p>

      <h4>Citations</h4>
      {data.citations?.length ? (
        <ul>
          {data.citations.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No citations returned.</p>
      )}

      <h4>Retrieval Stats</h4>
      <p>
        snippets={snippets.length}, nodes={nodes.length}, edges={edges.length}
      </p>

      <h4>Visual Explanation</h4>
      <AnswerExplanationPanel
        question={question}
        snippets={snippets}
        nodes={nodes}
        edges={edges}
        citations={data.citations ?? []}
      />

      <div className="detail-toggle-row">
        <Button type="button" variant="outline" className="chip detail-toggle-btn" onClick={() => setShowDetailedGraph((prev) => !prev)}>
          {showDetailedGraph ? "Hide Detailed Graph" : "Show Detailed Graph"}
        </Button>
      </div>
      {showDetailedGraph && <GraphPanel nodes={nodes} edges={edges} snippets={snippets} citations={data.citations ?? []} />}
    </div>
  );
}

function JobsPage() {
  const [repoId, setRepoId] = useLocalStorageState("cg.repo_id", "");
  const jobsQ = useQuery({
    queryKey: ["jobs-page", repoId],
    queryFn: () => listJobs(repoId),
    enabled: Boolean(repoId),
    refetchInterval: 4000,
  });

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="stack">
      <section className="card">
        <h2>Jobs</h2>
        <label>
          Repo ID
          <Input value={repoId} onChange={(e) => setRepoId(e.target.value)} placeholder="repo UUID" />
        </label>
        {jobsQ.error && <p className="error">{(jobsQ.error as Error).message}</p>}
        {!repoId && <p className="muted">Run ingest on Dashboard first, or paste a repo id to inspect jobs.</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Step</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {(jobsQ.data ?? []).map((job) => (
                <tr key={job.job_id}>
                  <td>{job.job_id}</td>
                  <td>{job.status}</td>
                  <td>{job.progress}%</td>
                  <td>{job.current_step}</td>
                  <td>{formatTime(job.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </motion.div>
  );
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}
