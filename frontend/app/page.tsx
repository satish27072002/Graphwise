"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { SearchBar } from "@/components/SearchBar";
import { AnswerPanel } from "@/components/AnswerPanel";
import { GraphCanvas } from "@/components/GraphCanvas";
import { CodeReferencesPanel } from "@/components/CodeReferencesPanel";
import { IngestSheet } from "@/components/IngestSheet";
import { queryCodebase, getNodeGraph } from "@/lib/api";
import { detectVisualizationMode, type VisualizationMode } from "@/lib/vizMode";
import type { QueryResponse, GraphData, AppState } from "@/types";

const EXAMPLE_QUERIES = [
  "How does authentication work?",
  "What calls process_payment()?",
  "What breaks if I change User.save()?",
  "Show all DB queries in the payment flow",
];

// Minimal logo SVG — hexagonal node graph icon
function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="4" r="2.5" fill="var(--accent-primary)" />
      <circle cx="4"  cy="18" r="2.5" fill="var(--accent-class)" />
      <circle cx="20" cy="18" r="2.5" fill="var(--accent-file)" />
      <line x1="12" y1="6.5" x2="5.2"  y2="15.8" stroke="var(--bg-border)" strokeWidth="1.5" />
      <line x1="12" y1="6.5" x2="18.8" y2="15.8" stroke="var(--bg-border)" strokeWidth="1.5" />
      <line x1="6.5" y1="18" x2="17.5" y2="18"   stroke="var(--bg-border)" strokeWidth="1.5" />
    </svg>
  );
}

export default function HomePage() {
  const [appState, setAppState] = useState<AppState>("empty");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedCodebase, setSelectedCodebase] = useState("default");
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [vizMode, setVizMode] = useState<VisualizationMode>("flow");

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
      setVizMode(detectVisualizationMode(question, result.retrieval_method));
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
        className="flex-1 flex flex-col items-center justify-center px-4 w-full"
        style={{ background: "var(--bg-base)" }}
      >
        {/* Top-right: Ingest button — fixed to viewport */}
        <div className="fixed top-5 right-6 z-20">
          <button
            onClick={() => setIsIngestOpen(true)}
            className="text-xs font-mono px-4 py-2 rounded-md border transition-all"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--bg-border)",
              borderLeftColor: "var(--accent-primary)",
              borderLeftWidth: 2,
              color: "var(--text-secondary)",
              boxShadow: "var(--shadow-sm)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "var(--accent-primary)";
              e.currentTarget.style.color = "var(--text-primary)";
              e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent-primary), 0 0 12px rgba(59,130,246,0.12)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "var(--bg-border)";
              e.currentTarget.style.borderLeftColor = "var(--accent-primary)";
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.boxShadow = "var(--shadow-sm)";
            }}
          >
            + Ingest Codebase
          </button>
        </div>

        {/* Hero content */}
        <div className="w-full max-w-2xl flex flex-col gap-8">
          {/* Title + subtitle */}
          <div className="text-center animate-fade-up">
            <div className="flex items-center justify-center gap-3 mb-3">
              <Logo size={28} />
              <h1
                className="text-3xl font-semibold tracking-tight"
                style={{
                  background: "var(--gradient-title)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  letterSpacing: "-0.03em",
                }}
              >
                CodeGraph Navigator
              </h1>
            </div>
            <p
              className="text-sm font-mono animate-fade-up animate-delay-100"
              style={{ color: "var(--text-secondary)" }}
            >
              Understand any codebase — instantly
            </p>
          </div>

          {/* Search card */}
          <div
            className="w-full rounded-xl border p-6 flex flex-col gap-5 animate-fade-up animate-delay-200"
            style={{
              background: "var(--glass-bg)",
              borderColor: "var(--glass-border)",
              boxShadow: "var(--shadow-md)",
              backdropFilter: "blur(8px)",
            }}
          >
            <SearchBar
              onSubmit={handleQuery}
              isLoading={isLoading}
              placeholder="Ask anything about your codebase..."
            />

            <div className="flex flex-col gap-1">
              <p
                className="text-xs font-mono mb-1"
                style={{ color: "var(--text-muted)", letterSpacing: "0.06em" }}
              >
                TRY AN EXAMPLE
              </p>
              {EXAMPLE_QUERIES.map((q, i) => (
                <button
                  key={q}
                  onClick={() => handleQuery(q)}
                  className="text-left text-sm font-mono transition-all bg-transparent border-none outline-none cursor-pointer p-0 animate-fade-up"
                  style={{
                    color: "var(--text-muted)",
                    animationDelay: `${300 + i * 50}ms`,
                    opacity: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                >
                  <span style={{ color: "var(--accent-primary)", marginRight: 6 }}>›</span>
                  {q}
                </button>
              ))}
            </div>
          </div>

          <p
            className="text-center text-xs font-mono animate-fade-up animate-delay-300"
            style={{ color: "var(--text-muted)" }}
          >
            Upload a Python codebase via &ldquo;Ingest Codebase&rdquo; to get started
          </p>
        </div>

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
      className="flex-1 flex flex-col overflow-hidden w-full"
      style={{ background: "var(--bg-base)" }}
    >
      {/* Glassmorphism header — full width */}
      <header
        className="flex items-center gap-3 px-5 py-2.5 shrink-0 border-b w-full"
        style={{
          borderColor: "var(--glass-border)",
          background: "rgba(8,8,8,0.90)",
          backdropFilter: "blur(12px) saturate(150%)",
          boxShadow: "0 1px 0 var(--glass-border)",
          minHeight: 52,
        }}
      >
        {/* Logo + title */}
        <div className="flex items-center gap-2 shrink-0">
          <Logo size={18} />
          <span
            className="text-sm font-semibold whitespace-nowrap"
            style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}
          >
            CodeGraph
          </span>
        </div>

        {/* Search bar — fills remaining space */}
        <div className="flex-1 min-w-0">
          <SearchBar
            onSubmit={handleQuery}
            isLoading={isLoading}
            defaultValue={currentQuestion}
          />
        </div>

        {/* Right: codebase badge + ingest button */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1.5 rounded-md border"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--bg-border)",
              color: "var(--text-secondary)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: "var(--accent-file)" }}
            />
            {selectedCodebase}
          </div>

          <button
            onClick={() => setIsIngestOpen(true)}
            className="text-[10px] font-mono px-3 py-1.5 rounded-md border transition-all whitespace-nowrap"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--bg-border)",
              color: "var(--text-secondary)",
              boxShadow: "var(--shadow-sm)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "var(--accent-primary)";
              e.currentTarget.style.color = "var(--text-primary)";
              e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent-primary), 0 0 10px rgba(59,130,246,0.1)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "var(--bg-border)";
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.boxShadow = "var(--shadow-sm)";
            }}
          >
            + Ingest
          </button>
        </div>
      </header>

      {/* Main content: Answer (38%) | Graph (62%) — both fill available height */}
      <div className="flex flex-1 overflow-hidden min-h-0 w-full">
        {/* Answer panel — 38% width */}
        <div
          className="overflow-hidden flex flex-col min-h-0"
          style={{
            width: "38%",
            boxShadow: "inset -1px 0 0 var(--bg-border)",
          }}
        >
          <AnswerPanel response={response} isLoading={isLoading} />
        </div>

        {/* Graph canvas — fills remaining 62% */}
        <div
          className="flex-1 overflow-hidden min-h-0"
          style={{ position: "relative" }}
        >
          <GraphCanvas
            graph={graphData}
            vizMode={vizMode}
            onVizModeChange={setVizMode}
            onNodeClick={handleNodeClick}
          />
        </div>
      </div>

      {/* Code references strip — fixed height, no overflow expansion */}
      <div
        className="shrink-0 border-t w-full"
        style={{
          borderColor: "var(--bg-border)",
          maxHeight: 148,
          overflow: "hidden",
        }}
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
