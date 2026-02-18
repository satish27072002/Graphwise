"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { CodeSnippet } from "@/components/CodeSnippet";
import type { SourceReference, NodeType } from "@/types";

const NODE_TYPE_COLORS: Record<NodeType, string> = {
  Function: "var(--accent-function)",
  Class:    "var(--accent-class)",
  File:     "var(--accent-file)",
  Module:   "var(--accent-module)",
};

interface CodeReferencesPanelProps {
  sources: SourceReference[];
}

export function CodeReferencesPanel({ sources }: CodeReferencesPanelProps) {
  const [openSource, setOpenSource] = useState<SourceReference | null>(null);

  if (sources.length === 0) return null;

  return (
    <>
      {/* Strip */}
      <div
        className="px-4 py-2 border-b"
        style={{ borderColor: "var(--bg-border)" }}
      >
        <p className="text-xs font-mono tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
          CODE REFERENCES
        </p>
      </div>
      <div
        className="flex gap-3 overflow-x-auto px-4 py-3"
        style={{ minHeight: 64, maxHeight: 120 }}
      >
        {sources.map((src, i) => {
          // Guess node type from name heuristic
          const nodeType: NodeType = src.name.includes(".") ? "Function" : "Function";
          const dotColor = NODE_TYPE_COLORS[nodeType];
          const barWidth = Math.round(src.relevance_score * 80);

          return (
            <div
              key={i}
              className="flex items-center gap-3 shrink-0 px-3 py-2 rounded-md border cursor-default"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--bg-border)",
                minWidth: 280,
              }}
            >
              {/* Colored dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: dotColor }}
              />

              {/* Name + file */}
              <div className="flex-1 min-w-0">
                <p
                  className="font-mono text-xs truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {src.name}
                </p>
                <p
                  className="font-mono text-[10px] truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {src.file} : {src.start_line}–{src.end_line}
                </p>
              </div>

              {/* Relevance bar */}
              <div
                className="rounded shrink-0"
                style={{
                  width: 80,
                  height: 4,
                  background: "var(--bg-border)",
                  overflow: "hidden",
                }}
              >
                <div
                  className="h-full rounded"
                  style={{
                    width: barWidth,
                    background: "var(--accent-primary)",
                  }}
                />
              </div>

              {/* Score */}
              <span
                className="font-mono text-[10px] shrink-0"
                style={{ color: "var(--text-muted)", width: 32, textAlign: "right" }}
              >
                {src.relevance_score.toFixed(2)}
              </span>

              {/* View button */}
              <button
                onClick={() => setOpenSource(src)}
                className="shrink-0 flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border transition-colors"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--bg-border)",
                  color: "var(--text-secondary)",
                }}
              >
                View <ExternalLink size={9} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Code viewer sheet */}
      {openSource && (
        <CodeViewerSheet
          source={openSource}
          onClose={() => setOpenSource(null)}
        />
      )}
    </>
  );
}

// ── Inline slide-in drawer ───────────────────────────────────────────────────

function CodeViewerSheet({
  source,
  onClose,
}: {
  source: SourceReference;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 overflow-y-auto p-6 border-l"
        style={{
          width: 480,
          background: "var(--bg-surface)",
          borderColor: "var(--bg-border)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {source.name}
          </h2>
          <button
            onClick={onClose}
            className="font-mono text-sm px-2 py-1 rounded"
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>
        <CodeSnippet
          name={source.name}
          file={source.file}
          start_line={source.start_line}
          end_line={source.end_line}
          code={source.code}
        />
      </div>
    </>
  );
}
