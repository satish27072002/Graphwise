import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  QuestionGraph,
  QuestionGraphEdge,
  QuestionGraphNode,
  QuestionGraphNodeType,
} from "./types";
import "reactflow/dist/style.css";
import {
  getJob,
  health,
  ingestZip,
  listJobs,
  queryRepo,
  type UnifiedQueryResult,
  repoStatus,
  type Job,
} from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProgressBar } from "./components/ui/ProgressBar";
import { InteractiveQuestionGraph } from "./components/GraphView";

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

// ──────────────────────────────────────────────────────────
// Build QuestionGraph from unified query result
// ──────────────────────────────────────────────────────────
const QG_MAX_NODES = 60;
const QG_MAX_EDGES = 80;

function _qgNodeId(type: QuestionGraphNodeType, key: string): string {
  return `${type}:${key}`;
}

function buildQuestionGraph(question: string, result: UnifiedQueryResult): QuestionGraph {
  const nodeMap = new Map<string, QuestionGraphNode>();
  const edges: QuestionGraphEdge[] = [];
  const edgeIds = new Set<string>();

  const addNode = (node: QuestionGraphNode) => {
    if (nodeMap.has(node.id)) return;
    if (nodeMap.size >= QG_MAX_NODES) return;
    nodeMap.set(node.id, node);
  };

  const addEdge = (edge: QuestionGraphEdge) => {
    if (edges.length >= QG_MAX_EDGES) return;
    if (edgeIds.has(edge.id)) return;
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) return;
    edgeIds.add(edge.id);
    edges.push(edge);
  };

  // Root question node
  const questionId = _qgNodeId("question", "root");
  addNode({
    id: questionId,
    type: "question",
    label: truncate(question || "Question", 120),
  });

  // Map server graph nodes → QuestionGraph nodes
  const serverIdToQgId = new Map<string, string>();
  for (const node of result.graph.nodes) {
    const nodeType = node.type || "code";
    const qgId = _qgNodeId(nodeType, node.id);
    serverIdToQgId.set(node.id, qgId);
    addNode({
      id: qgId,
      type: nodeType,
      label: node.label || node.id,
      subtitle: node.path || undefined,
      ref_id: node.id,
      meta: { path: node.path },
    });
  }

  // Connect question root to top-level nodes (those with no incoming edges from other graph nodes)
  const hasIncomingFromGraph = new Set<string>();
  for (const edge of result.graph.edges) {
    hasIncomingFromGraph.add(edge.target);
  }

  for (const node of result.graph.nodes) {
    const qgId = serverIdToQgId.get(node.id);
    if (!qgId) continue;
    if (!hasIncomingFromGraph.has(node.id)) {
      addEdge({
        id: `qg:root:${node.id}`,
        source: questionId,
        target: qgId,
        label: "related",
      });
    }
  }

  // Add edges from server graph
  for (let i = 0; i < result.graph.edges.length; i++) {
    const edge = result.graph.edges[i];
    const srcQgId = serverIdToQgId.get(edge.source);
    const tgtQgId = serverIdToQgId.get(edge.target);
    if (!srcQgId || !tgtQgId) continue;
    addEdge({
      id: `qg:edge:${edge.id || i}`,
      source: srcQgId,
      target: tgtQgId,
      label: edge.label || "related",
    });
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}

// ──────────────────────────────────────────────────────────
// Dashboard page
// ──────────────────────────────────────────────────────────
function Dashboard() {
  const [repoId, setRepoId] = useLocalStorageState("cg.repo_id", "");
  const [jobId, setJobId] = useLocalStorageState("cg.job_id", "");
  const [question, setQuestion] = useLocalStorageState("cg.question", "What does this repository do?");
  const [queryResult, setQueryResult] = useState<UnifiedQueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
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
    mutationFn: async () => {
      const normalizedRepo = repoId.trim();
      const normalizedQuestion = question.trim();
      if (!normalizedRepo) throw new Error("Provide a repo id");
      if (!normalizedQuestion) throw new Error("Provide a question");
      return queryRepo(normalizedRepo, normalizedQuestion);
    },
    onMutate: () => {
      setQueryError(null);
      setQueryResult(null);
    },
    onSuccess: (result) => {
      setQueryResult(result);
    },
    onError: (err: Error) => {
      setQueryError(err.message);
    },
  });

  const running = useMemo(() => {
    const jobs = jobsQ.data ?? [];
    return jobs.filter((j) => j.status === "running").length;
  }, [jobsQ.data]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="stack">
      <section className="card">
        <h2>Summary</h2>
        <div className="stack">
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

          <section className="cards cards-2">
            <article className="card">
              <h3>Repo Status</h3>
              <div className="space-y-4">
                <label className="block">
                  <span className="text-sm text-slate-400 mb-1 block">Active Repo ID</span>
                  <Input value={repoId} onChange={(e) => setRepoId(e.target.value)} placeholder="repo UUID" />
                </label>
                {repoStatusQ.data && (
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Nodes</p>
                      <p className="text-xl font-bold text-blue-400">{repoStatusQ.data.indexed_node_count}</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Edges</p>
                      <p className="text-xl font-bold text-indigo-400">{repoStatusQ.data.indexed_edge_count}</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Embedded</p>
                      <p className="text-xl font-bold text-violet-400">{repoStatusQ.data.embedded_nodes}</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">KG Index</p>
                      <p className={`text-xl font-bold ${repoStatusQ.data.embeddings_exist ? "text-emerald-400" : "text-amber-400"}`}>
                        {repoStatusQ.data.embeddings_exist ? "Active" : "None"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </article>

            <article className="card flex flex-col justify-center">
              <h3>Ingestion Progress</h3>
              {jobQ.data ? (
                <div className="mt-2">
                  <ProgressBar
                    status={jobQ.data.status as import("./components/ui/ProgressBar").JobStatus}
                    progress={jobQ.data.progress ?? 0}
                    currentStep={jobQ.data.current_step ?? ""}
                    error={jobQ.data.error}
                  />
                  <p className="text-xs text-slate-500 mt-3 text-center">
                    Updating: {formatTime(jobQ.data.updated_at)}
                  </p>
                </div>
              ) : (
                <div className="text-center py-8 opacity-40">
                  <p className="text-sm">No active ingestion job</p>
                  <p className="text-xs mt-1">Status will appear here during processing</p>
                </div>
              )}
            </article>
          </section>
        </div>
      </section>

      <section className="card">
        <h2>Ingestion</h2>
        <div className="dashboard-ingest-layout">
          <form
            className="stack compact"
            onSubmit={(e) => {
              e.preventDefault();
              ingestZipM.mutate();
            }}
          >
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
        </div>
      </section>

      {repoId && (
        <section className="card">
          <h2>Ask a Question</h2>
          <label>
            Question
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={4}
              placeholder="Ask about architecture, dependencies, key classes, or where a function is used..."
            />
          </label>
          <Button onClick={() => queryM.mutate()} disabled={queryM.isPending}>
            {queryM.isPending ? "Asking..." : "Ask"}
          </Button>
          {queryM.error && <p className="error">{(queryM.error as Error).message}</p>}
        </section>
      )}

      <section className="card">
        <h2>Answer</h2>
        <AnswerPanel question={question} result={queryResult} error={queryError} />
      </section>

      {queryResult && (
        <GraphWorkspace question={question} result={queryResult} />
      )}
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────
// Answer panel — single unified answer
// ──────────────────────────────────────────────────────────
function AnswerPanel({
  question,
  result,
  error,
}: {
  question: string;
  result: UnifiedQueryResult | null;
  error: string | null;
}) {
  if (!result && !error) {
    return <p className="muted">Ask a question to get a combined GraphRAG answer with code structure and semantic graph context.</p>;
  }

  if (error && !result) {
    return <p className="error">{error}</p>;
  }

  if (!result) return null;

  const graphStats = {
    nodes: result.graph.nodes.length,
    edges: result.graph.edges.length,
    concepts: result.graph.nodes.filter((n) => n.type === "concept").length,
    code: result.graph.nodes.filter((n) => ["file", "class", "function", "code"].includes(n.type)).length,
  };

  return (
    <div className="result-box">
      <div className="mb-6 p-6 rounded-2xl bg-gradient-to-br from-violet-500/10 to-transparent border border-violet-500/20 shadow-lg">
        <h3 className="text-violet-300 mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          Answer
        </h3>
        <div className="prose prose-invert max-w-none text-gray-100 leading-relaxed">
          {result.answer.split('\n').map((line, i) => (
            <p key={i} className="mb-2 last:mb-0">{line}</p>
          ))}
        </div>
      </div>

      <h3>Question</h3>
      <p>{question}</p>

      <div className="job-details">
        <p>
          Graph: <strong>{graphStats.nodes}</strong> nodes · <strong>{graphStats.edges}</strong> edges
          {graphStats.concepts > 0 && <> · <strong>{graphStats.concepts}</strong> semantic concepts</>}
          {graphStats.code > 0 && <> · <strong>{graphStats.code}</strong> code nodes</>}
        </p>
        {result.citations.length > 0 && (
          <p className="muted small">Citations: {result.citations.slice(0, 5).join(", ")}{result.citations.length > 5 ? ` +${result.citations.length - 5} more` : ""}</p>
        )}
        {result.warning && <p className="warning">{result.warning}</p>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Graph workspace — single unified graph canvas
// ──────────────────────────────────────────────────────────
function GraphWorkspace({
  question,
  result,
}: {
  question: string;
  result: UnifiedQueryResult;
}) {
  const questionGraph = useMemo(() => buildQuestionGraph(question, result), [question, result]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focusSelection, setFocusSelection] = useState(false);

  const questionNodeId = useMemo(
    () => questionGraph.nodes.find((n) => n.type === "question")?.id ?? null,
    [questionGraph.nodes],
  );

  const visibleGraph = useMemo(() => {
    if (!focusSelection) return questionGraph;
    const seedIds = new Set<string>();
    if (selectedNodeId) seedIds.add(selectedNodeId);
    if (selectedEdgeId) {
      const sel = questionGraph.edges.find((e) => e.id === selectedEdgeId);
      if (sel) { seedIds.add(sel.source); seedIds.add(sel.target); }
    }
    if (!seedIds.size) return questionGraph;

    const neighborIds = new Set(seedIds);
    for (const edge of questionGraph.edges) {
      if (seedIds.has(edge.source) || seedIds.has(edge.target)) {
        neighborIds.add(edge.source);
        neighborIds.add(edge.target);
      }
    }
    return {
      nodes: questionGraph.nodes.filter((n) => neighborIds.has(n.id)),
      edges: questionGraph.edges.filter((e) => neighborIds.has(e.source) && neighborIds.has(e.target)),
    };
  }, [focusSelection, questionGraph, selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    setFocusSelection(false);
  }, [questionGraph.nodes, questionGraph.edges]);

  const selectedNode = useMemo(
    () => questionGraph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [questionGraph.nodes, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => questionGraph.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [questionGraph.edges, selectedEdgeId],
  );
  const nodeById = useMemo(() => new Map(questionGraph.nodes.map((n) => [n.id, n])), [questionGraph.nodes]);

  const graphStats = useMemo(() => ({
    total: questionGraph.nodes.length,
    code: questionGraph.nodes.filter((n) => ["file", "class", "function", "code"].includes(n.type)).length,
    concept: questionGraph.nodes.filter((n) => n.type === "concept").length,
    evidence: questionGraph.nodes.filter((n) => n.type === "evidence").length,
    edges: questionGraph.edges.length,
  }), [questionGraph]);

  return (
    <div className="kg-answer-columns">
      <div className="kg-answer-left">
        <section className="kg-panel">
          <div className="flex items-center justify-between mb-2">
            <h4>Graph View (Interactive)</h4>
          </div>

          <div className="qg-toolbar">
            <div className="qg-actions">
              <Button
                type="button"
                variant="outline"
                className="chip"
                disabled={!selectedNodeId && !selectedEdgeId}
                onClick={() => setFocusSelection(true)}
              >
                Focus selection
              </Button>
              <Button
                type="button"
                variant="outline"
                className="chip"
                onClick={() => {
                  setFocusSelection(false);
                  if (questionNodeId) setSelectedNodeId(questionNodeId);
                }}
              >
                Reset to question
              </Button>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40 shadow-inner" style={{ height: "650px" }}>
            <InteractiveQuestionGraph
              graph={visibleGraph}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              onSelectNode={(nodeId) => {
                setSelectedEdgeId(null);
                setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
              }}
              onSelectEdge={(edgeId) => {
                setSelectedNodeId(null);
                setSelectedEdgeId((prev) => (prev === edgeId ? null : edgeId));
              }}
            />
          </div>
          {focusSelection && <p className="muted small">Showing selection and 1-hop neighbors.</p>}
        </section>
      </div>

      <div className="kg-answer-right">
        <section className="kg-panel">
          <h4>Details</h4>

          {selectedEdge ? (
            <div className="kg-selected-edge-card">
              <p className="muted small">Selected edge</p>
              <p>
                <strong>{nodeById.get(selectedEdge.source)?.label ?? selectedEdge.source}</strong>{" "}
                --({selectedEdge.label})--&gt;{" "}
                <strong>{nodeById.get(selectedEdge.target)?.label ?? selectedEdge.target}</strong>
              </p>
            </div>
          ) : null}

          {selectedNode ? (
            <div className="result-box">
              <h3>{selectedNode.label}</h3>
              <p className="muted small">
                type={selectedNode.type}
                {selectedNode.subtitle ? ` · ${selectedNode.subtitle}` : ""}
              </p>
              {selectedNode.type === "question" && (
                <>
                  <h4>Graph Summary</h4>
                  <ul>
                    <li>Total nodes: {graphStats.total}</li>
                    <li>Code nodes (file/class/function): {graphStats.code}</li>
                    <li>Concept nodes (semantic): {graphStats.concept}</li>
                    <li>Evidence nodes: {graphStats.evidence}</li>
                    <li>Edges: {graphStats.edges}</li>
                  </ul>
                </>
              )}
              {(selectedNode.type === "concept" || selectedNode.type === "entity") && (
                <>
                  <h4>Semantic Entity</h4>
                  <p className="muted small">This node was extracted from code semantics by the knowledge graph pipeline.</p>
                </>
              )}
              {["file", "class", "function", "code"].includes(selectedNode.type) && (
                <>
                  <h4>Code Node</h4>
                  {selectedNode.subtitle && <p className="muted small">Path: {selectedNode.subtitle}</p>}
                </>
              )}
            </div>
          ) : !selectedEdge ? (
            <div className="result-box">
              <p className="muted">Select a graph node or edge to inspect details.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Metric</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Total nodes</td><td>{graphStats.total}</td></tr>
                    <tr><td>Code nodes</td><td>{graphStats.code}</td></tr>
                    <tr><td>Concept nodes</td><td>{graphStats.concept}</td></tr>
                    <tr><td>Evidence nodes</td><td>{graphStats.evidence}</td></tr>
                    <tr><td>Total edges</td><td>{graphStats.edges}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Jobs page
// ──────────────────────────────────────────────────────────
function Jobs() {
  const [repoId, setRepoId] = useLocalStorageState("cg.repo_id", "");

  const jobsQ = useQuery({
    queryKey: ["jobs", repoId],
    queryFn: () => listJobs(repoId),
    enabled: Boolean(repoId),
    refetchInterval: 5000,
  });

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="stack">
      <section className="card">
        <h2>Jobs</h2>
        <label>
          Repo ID
          <Input value={repoId} onChange={(e) => setRepoId(e.target.value)} placeholder="repo UUID" />
        </label>
        {jobsQ.isLoading && <p className="muted">Loading jobs...</p>}
        {jobsQ.error && <p className="error">{(jobsQ.error as Error).message}</p>}
        {jobsQ.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Step</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {jobsQ.data.map((job) => (
                  <tr key={job.job_id}>
                    <td className="muted small">{job.job_id.slice(0, 8)}…</td>
                    <td>{job.job_type}</td>
                    <td className={job.status === "completed" ? "ok" : job.status === "failed" ? "bad" : ""}>{job.status}</td>
                    <td>{job.progress}%</td>
                    <td>{job.current_step}</td>
                    <td className="muted small">{formatTime(job.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────
// App router
// ──────────────────────────────────────────────────────────
export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/jobs" element={<Jobs />} />
      </Routes>
    </Shell>
  );
}
