"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ingestCodebase, ingestFromGithub, ingestFromZip } from "@/lib/api";
import type { IngestProgress } from "@/types";

interface IngestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (codebase_id: string) => void;
}

type IngestTab = "local" | "github" | "zip";

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
  if (status === "running")
    return (
      <span className="animate-spin inline-block" style={{ color: "var(--accent-primary)" }}>
        ⟳
      </span>
    );
  if (status === "error") return <span style={{ color: "#ef4444" }}>✗</span>;
  return <span style={{ color: "var(--text-muted)" }}>○</span>;
}

const TABS: { id: IngestTab; label: string }[] = [
  { id: "local", label: "Local Path" },
  { id: "github", label: "GitHub URL" },
  { id: "zip", label: "ZIP Upload" },
];

export function IngestSheet({ open, onOpenChange, onSuccess }: IngestSheetProps) {
  const [activeTab, setActiveTab] = useState<IngestTab>("local");

  // Local path state
  const [repoPath, setRepoPath] = useState("");

  // GitHub state
  const [githubUrl, setGithubUrl] = useState("");
  const [githubUrlError, setGithubUrlError] = useState("");

  // ZIP state
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared state
  const [codebaseId, setCodebaseId] = useState("default");
  const [steps, setSteps] = useState<IngestProgress[]>(INITIAL_STEPS);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  if (!open) return null;

  const markStep = (index: number, status: IngestProgress["status"], count?: number) => {
    setSteps(prev => prev.map((s, i) => (i === index ? { ...s, status, count } : s)));
  };

  const animateSteps = () => {
    [0, 200, 400, 600, 800, 1000].forEach((d, i) => {
      setTimeout(() => markStep(i, "running"), d);
    });
  };

  const handleSuccess = (nodes: number, rels: number, cbId: string) => {
    setSteps(prev => prev.map(s => ({ ...s, status: "done" as const })));
    setIsDone(true);
    toast.success(`Ingested ${nodes} nodes, ${rels} relationships`);
    setTimeout(() => onSuccess(cbId), 800);
  };

  const handleError = (err: unknown) => {
    setSteps(prev =>
      prev.map(s => (s.status === "running" ? { ...s, status: "error" as const } : s)),
    );
    toast.error(`Ingest failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  };

  const canSubmit = () => {
    if (isIngesting) return false;
    if (activeTab === "local") return repoPath.trim().length > 0;
    if (activeTab === "github")
      return githubUrl.trim().startsWith("https://github.com/") && !githubUrlError;
    if (activeTab === "zip") return zipFile !== null;
    return false;
  };

  const validateGithubUrl = (url: string) => {
    if (url && !url.startsWith("https://github.com/")) {
      setGithubUrlError("URL must start with https://github.com/");
    } else {
      setGithubUrlError("");
    }
  };

  const handleIngest = async () => {
    if (!canSubmit()) return;

    const cbId = codebaseId.trim() || "default";
    setIsIngesting(true);
    setIsDone(false);
    setSteps(INITIAL_STEPS.map(s => ({ ...s, status: "pending" as const })));
    animateSteps();

    try {
      if (activeTab === "local") {
        const r = await ingestCodebase({ repo_path: repoPath.trim(), codebase_id: cbId, language: "python" });
        handleSuccess(r.nodes_created, r.relationships_created, cbId);
      } else if (activeTab === "github") {
        const r = await ingestFromGithub({ github_url: githubUrl.trim(), codebase_id: cbId, language: "python" });
        handleSuccess(r.nodes_created, r.relationships_created, cbId);
      } else if (activeTab === "zip" && zipFile) {
        const r = await ingestFromZip(zipFile, cbId);
        handleSuccess(r.nodes_created, r.relationships_created, cbId);
      }
    } catch (err) {
      handleError(err);
    } finally {
      setIsIngesting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".zip")) {
      setZipFile(file);
    } else {
      toast.error("Please drop a .zip file");
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setZipFile(file);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── Shared input style ──────────────────────────────────────────────────
  const inputStyle = {
    background: "var(--bg-elevated)",
    borderColor: "var(--bg-border)",
    color: "var(--text-primary)",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={() => !isIngesting && onOpenChange(false)}
      />

      {/* Sheet — right side panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col border-l"
        style={{
          width: 460,
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
            className="font-mono text-sm px-2 py-1 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex px-6 pt-3 gap-0 border-b" style={{ borderColor: "var(--bg-border)" }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => !isIngesting && setActiveTab(tab.id)}
                className="text-xs font-mono px-4 py-2.5 border-b-2 transition-all"
                style={{
                  borderBottomColor: isActive ? "var(--accent-primary)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  background: "transparent",
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Local Path Tab ── */}
          {activeTab === "local" && (
            <div className="space-y-2">
              <label className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                Repository Path
              </label>
              <input
                type="text"
                value={repoPath}
                onChange={e => setRepoPath(e.target.value)}
                placeholder="/path/to/your/repo"
                disabled={isIngesting}
                className="w-full px-3 py-2 rounded-md border text-sm font-mono outline-none"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = "var(--accent-primary)")}
                onBlur={e => (e.target.style.borderColor = "var(--bg-border)")}
              />
              <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                Absolute path to a local Python project accessible by the Docker container.
              </p>
            </div>
          )}

          {/* ── GitHub URL Tab ── */}
          {activeTab === "github" && (
            <div className="space-y-2">
              <label className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                GitHub Repository URL
              </label>
              <input
                type="url"
                value={githubUrl}
                onChange={e => {
                  setGithubUrl(e.target.value);
                  validateGithubUrl(e.target.value);
                }}
                placeholder="https://github.com/owner/repo"
                disabled={isIngesting}
                className="w-full px-3 py-2 rounded-md border text-sm font-mono outline-none"
                style={{
                  ...inputStyle,
                  borderColor: githubUrlError ? "#ef4444" : "var(--bg-border)",
                }}
                onFocus={e =>
                  (e.target.style.borderColor = githubUrlError ? "#ef4444" : "var(--accent-primary)")
                }
                onBlur={e =>
                  (e.target.style.borderColor = githubUrlError ? "#ef4444" : "var(--bg-border)")
                }
              />
              <p
                className="text-[10px] font-mono"
                style={{ color: githubUrlError ? "#ef4444" : "var(--text-muted)" }}
              >
                {githubUrlError || "Public repos only. Shallow-cloned and deleted after ingestion."}
              </p>
            </div>
          )}

          {/* ── ZIP Upload Tab ── */}
          {activeTab === "zip" && (
            <div className="space-y-2">
              <label className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                ZIP File
              </label>
              <div
                className="w-full rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors"
                style={{
                  minHeight: 130,
                  borderColor: isDragOver ? "var(--accent-primary)" : "var(--bg-border)",
                  background: isDragOver ? "var(--bg-elevated)" : "var(--bg-base)",
                  padding: "20px 16px",
                }}
                onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !isIngesting && fileInputRef.current?.click()}
              >
                {zipFile ? (
                  <>
                    <span style={{ fontSize: 26 }}>📦</span>
                    <div className="text-center">
                      <p className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                        {zipFile.name}
                      </p>
                      <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {formatBytes(zipFile.size)}
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setZipFile(null); }}
                      className="text-[10px] font-mono px-2 py-1 rounded border"
                      style={{
                        borderColor: "var(--bg-border)",
                        color: "var(--text-muted)",
                        background: "var(--bg-surface)",
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 30, opacity: 0.35 }}>📁</span>
                    <p className="text-xs font-mono text-center" style={{ color: "var(--text-muted)" }}>
                      Drag & drop a .zip file here
                      <br />
                      <span style={{ opacity: 0.6 }}>or click to browse</span>
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleFileInput}
                disabled={isIngesting}
              />
              <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                Max 100 MB. Must contain Python source files.
              </p>
            </div>
          )}

          {/* Codebase ID — always visible */}
          <div className="space-y-2">
            <label className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
              Codebase ID
            </label>
            <input
              type="text"
              value={codebaseId}
              onChange={e => setCodebaseId(e.target.value)}
              placeholder="e.g. flask, myproject"
              disabled={isIngesting}
              className="w-full px-3 py-2 rounded-md border text-sm font-mono outline-none"
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = "var(--accent-primary)")}
              onBlur={e => (e.target.style.borderColor = "var(--bg-border)")}
            />
            <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              Unique name for this codebase — namespaces all graph nodes.
            </p>
          </div>

          {/* Progress feed */}
          {(isIngesting || isDone) && (
            <div
              className="rounded-md p-4 space-y-2.5 border"
              style={{ background: "var(--bg-elevated)", borderColor: "var(--bg-border)" }}
            >
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm w-4 text-center font-mono">
                    <StepIcon status={step.status} />
                  </span>
                  <span
                    className="text-xs font-mono flex-1"
                    style={{
                      color:
                        step.status === "pending"
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
        <div className="px-6 py-4 border-t" style={{ borderColor: "var(--bg-border)" }}>
          <button
            onClick={handleIngest}
            disabled={!canSubmit()}
            className="w-full py-2.5 rounded-md text-sm font-mono font-medium transition-all"
            style={{
              background: !canSubmit() ? "var(--bg-elevated)" : "var(--accent-primary)",
              color: !canSubmit() ? "var(--text-muted)" : "#fff",
              cursor: !canSubmit() ? "not-allowed" : "pointer",
            }}
          >
            {isIngesting ? "Ingesting..." : "Start Ingestion"}
          </button>
        </div>
      </div>
    </>
  );
}
