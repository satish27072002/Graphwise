"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { SearchBar } from "@/components/SearchBar";
import { AnswerPanel } from "@/components/AnswerPanel";
import { GraphCanvas } from "@/components/GraphCanvas";
import { CodeReferencesPanel } from "@/components/CodeReferencesPanel";
import { IngestSheet } from "@/components/IngestSheet";
import { queryCodebase, getNodeGraph } from "@/lib/api";
import type { QueryResponse, GraphData, AppState } from "@/types";

const EXAMPLE_QUERIES = [
  "How does authentication work?",
  "What calls process_payment()?",
  "What breaks if I change User.save()?",
  "Show me all database queries",
];

export default function HomePage() {
  const [appState, setAppState] = useState<AppState>("empty");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedCodebase, setSelectedCodebase] = useState("default");
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // ⌘K global shortcut focuses the search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleQuery = useCallback(async (question: string) => {
    if (!question.trim()) return;
    setCurrentQuestion(question);
    setIsLoading(true);
    setAppState("loading");

    try {
      const result = await queryCodebase({
        question,
        codebase_id: selectedCodebase,
        top_k: 5,
        hops: 2,
      });
      setResponse(result);
      setGraphData(result.graph);
      setAppState("results");
    } catch {
      toast.error("Query failed. Is the backend running?");
      setAppState(response ? "results" : "empty");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCodebase, response]);

  const handleNodeClick = useCallback(async (nodeId: string) => {
    try {
      const newGraph = await getNodeGraph(nodeId);
      setGraphData(prev => ({
        nodes: [
          ...prev.nodes,
          ...newGraph.nodes.filter(n => !prev.nodes.find(p => p.id === n.id)),
        ],
        edges: [
          ...prev.edges,
          ...newGraph.edges.filter(e => !prev.edges.find(p => p.id === e.id)),
        ],
      }));
    } catch {
      toast.error("Failed to load node graph");
    }
  }, []);

  const handleIngestSuccess = useCallback((codebase_id: string) => {
    setSelectedCodebase(codebase_id);
    setIsIngestOpen(false);
    toast.success(`Codebase '${codebase_id}' ingested successfully`);
  }, []);

  // ── Empty / loading state ─────────────────────────────────────────────
  if (appState === "empty" || (appState === "loading" && !response)) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center gap-10 px-4"
        style={{ background: "var(--bg-base)" }}
      >
        <div className="text-center space-y-2">
          <h1
            className="text-4xl font-semibold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            CodeGraph Navigator
          </h1>
          <p className="text-base" style={{ color: "var(--text-secondary)" }}>
            Understand any codebase instantly
          </p>
        </div>

        <div className="w-full max-w-2xl">
          <SearchBar
            onSubmit={handleQuery}
            isLoading={isLoading}
            placeholder="Ask anything about your codebase..."
          />
        </div>

        <div className="flex flex-col items-center gap-2">
          <p className="text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>
            Try:
          </p>
          {EXAMPLE_QUERIES.map(q => (
            <button
              key={q}
              onClick={() => handleQuery(q)}
              className="text-sm font-mono px-3 py-1 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-secondary)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              &ldquo;{q}&rdquo;
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsIngestOpen(true)}
          className="text-xs font-mono px-4 py-2 rounded border transition-colors"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--bg-border)",
            color: "var(--text-secondary)",
          }}
        >
          + Ingest a codebase
        </button>

        <IngestSheet
          open={isIngestOpen}
          onOpenChange={setIsIngestOpen}
          onSuccess={handleIngestSuccess}
        />
      </main>
    );
  }

  // ── Results state (three-panel layout) ─────────────────────────────────
  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-4 px-5 py-3 shrink-0 border-b"
        style={{ borderColor: "var(--bg-border)" }}
      >
        <span
          className="text-sm font-semibold tracking-tight whitespace-nowrap"
          style={{ color: "var(--text-primary)" }}
        >
          CodeGraph Navigator
        </span>

        <div className="flex-1 min-w-0">
          <SearchBar
            onSubmit={handleQuery}
            isLoading={isLoading}
            defaultValue={currentQuestion}
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-xs font-mono px-2 py-1 rounded border"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--bg-border)",
              color: "var(--text-muted)",
            }}
          >
            {selectedCodebase}
          </span>
          <button
            onClick={() => setIsIngestOpen(true)}
            className="text-xs font-mono px-3 py-1 rounded border transition-colors"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--bg-border)",
              color: "var(--text-secondary)",
            }}
          >
            + Ingest
          </button>
        </div>
      </header>

      {/* Main: Answer (38%) | Graph (62%) */}
      <div className="flex flex-1 overflow-hidden">
        <div
          className="border-r overflow-hidden flex flex-col"
          style={{ width: "38%", borderColor: "var(--bg-border)" }}
        >
          <AnswerPanel response={response} isLoading={isLoading} />
        </div>
        <div className="flex-1 overflow-hidden">
          <GraphCanvas graph={graphData} onNodeClick={handleNodeClick} />
        </div>
      </div>

      {/* Code references strip */}
      <div
        className="shrink-0 border-t"
        style={{ borderColor: "var(--bg-border)" }}
      >
        <CodeReferencesPanel sources={response?.sources ?? []} />
      </div>

      <IngestSheet
        open={isIngestOpen}
        onOpenChange={setIsIngestOpen}
        onSuccess={handleIngestSuccess}
      />
    </div>
  );
}
