"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ingestCodebase } from "@/lib/api";
import type { IngestProgress } from "@/types";

interface IngestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (codebase_id: string) => void;
}

const INITIAL_STEPS: IngestProgress[] = [
  { step: "Parsing Python files...", status: "pending" },
  { step: "Extracting functions/classes...", status: "pending" },
  { step: "Building graph relationships...", status: "pending" },
  { step: "Generating embeddings...", status: "pending" },
  { step: "Loading into Neo4j...", status: "pending" },
  { step: "Creating indexes...", status: "pending" },
];

function StepIcon({ status }: { status: IngestProgress["status"] }) {
  if (status === "done") return <span style={{ color: "#10b981" }}>✓</span>;
  if (status === "running") return <span className="animate-spin inline-block" style={{ color: "var(--accent-primary)" }}>⟳</span>;
  if (status === "error") return <span style={{ color: "#ef4444" }}>✗</span>;
  return <span style={{ color: "var(--text-muted)" }}>○</span>;
}

export function IngestSheet({ open, onOpenChange, onSuccess }: IngestSheetProps) {
  const [repoPath, setRepoPath] = useState("");
  const [codebases_id, setCodebaseId] = useState("default");
  const [steps, setSteps] = useState<IngestProgress[]>(INITIAL_STEPS);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  if (!open) return null;

  const markStep = (index: number, status: IngestProgress["status"], count?: number) => {
    setSteps(prev => prev.map((s, i) =>
      i === index ? { ...s, status, count } : s,
    ));
  };

  const handleIngest = async () => {
    if (!repoPath.trim()) {
      toast.error("Please enter a repository path");
      return;
    }

    setIsIngesting(true);
    setIsDone(false);
    setSteps(INITIAL_STEPS.map(s => ({ ...s, status: "pending" as const })));

    // Animate progress steps (simulated — real progress would need SSE)
    const delays = [0, 200, 400, 600, 800, 1000];
    const animateStep = (i: number) => {
      markStep(i, "running");
    };

    delays.forEach((d, i) => setTimeout(() => animateStep(i), d));

    try {
      const result = await ingestCodebase({
        repo_path: repoPath.trim(),
        codebase_id: codebases_id.trim() || "default",
        language: "python",
      });

      // Mark all steps done
      setSteps(prev => prev.map(s => ({ ...s, status: "done" })));
      setIsDone(true);

      toast.success(
        `Ingested ${result.nodes_created} nodes, ${result.relationships_created} relationships`,
      );

      setTimeout(() => {
        onSuccess(codebases_id.trim() || "default");
      }, 800);
    } catch (err) {
      setSteps(prev => prev.map((s, i) =>
        s.status === "running" ? { ...s, status: "error" } : s,
      ));
      toast.error(`Ingest failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={() => !isIngesting && onOpenChange(false)}
      />

      {/* Sheet — slides in from right */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col border-l"
        style={{
          width: 440,
          background: "var(--bg-surface)",
          borderColor: "var(--bg-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--bg-border)" }}
        >
          <h2 className="font-mono text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            + Ingest Codebase
          </h2>
          <button
            onClick={() => !isIngesting && onOpenChange(false)}
            className="font-mono text-sm px-2 py-1 rounded"
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
              Repository Path or GitHub URL
            </label>
            <input
              type="text"
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
              placeholder="/path/to/your/repo"
              disabled={isIngesting}
              className="w-full px-3 py-2 rounded-md border text-sm font-mono outline-none"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--bg-border)",
                color: "var(--text-primary)",
              }}
              onFocus={e => (e.target.style.borderColor = "var(--accent-primary)")}
              onBlur={e => (e.target.style.borderColor = "var(--bg-border)")}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
              Codebase ID
            </label>
            <input
              type="text"
              value={codebases_id}
              onChange={e => setCodebaseId(e.target.value)}
              placeholder="e.g. flask, myproject"
              disabled={isIngesting}
              className="w-full px-3 py-2 rounded-md border text-sm font-mono outline-none"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--bg-border)",
                color: "var(--text-primary)",
              }}
              onFocus={e => (e.target.style.borderColor = "var(--accent-primary)")}
              onBlur={e => (e.target.style.borderColor = "var(--bg-border)")}
            />
            <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              A unique identifier for this codebase. Used to namespace graph nodes.
            </p>
          </div>

          {/* Progress feed */}
          {(isIngesting || isDone) && (
            <div
              className="rounded-md p-4 space-y-2 border"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--bg-border)",
              }}
            >
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm w-4 text-center font-mono">
                    <StepIcon status={step.status} />
                  </span>
                  <span
                    className="text-xs font-mono flex-1"
                    style={{
                      color: step.status === "pending"
                        ? "var(--text-muted)"
                        : step.status === "done"
                        ? "var(--text-secondary)"
                        : "var(--text-primary)",
                    }}
                  >
                    {step.step}
                  </span>
                  {step.count !== undefined && (
                    <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                      {step.count}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t"
          style={{ borderColor: "var(--bg-border)" }}
        >
          <button
            onClick={handleIngest}
            disabled={isIngesting || !repoPath.trim()}
            className="w-full py-2.5 rounded-md text-sm font-mono font-medium transition-all"
            style={{
              background: isIngesting || !repoPath.trim()
                ? "var(--bg-elevated)"
                : "var(--accent-primary)",
              color: isIngesting || !repoPath.trim()
                ? "var(--text-muted)"
                : "#fff",
              cursor: isIngesting || !repoPath.trim() ? "not-allowed" : "pointer",
            }}
          >
            {isIngesting ? "Ingesting..." : "Start Ingestion"}
          </button>
        </div>
      </div>
    </>
  );
}
