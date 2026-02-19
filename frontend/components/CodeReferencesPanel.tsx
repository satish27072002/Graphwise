"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import { CodeSnippet } from "@/components/CodeSnippet";
import type { SourceReference } from "@/types";

interface CodeReferencesPanelProps {
  sources: SourceReference[];
}

export function CodeReferencesPanel({ sources }: CodeReferencesPanelProps) {
  const [openSource, setOpenSource] = useState<SourceReference | null>(null);

  if (sources.length === 0) return null;

  return (
    <>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b"
        style={{ borderColor: "var(--bg-border)" }}
      >
        <div
          className="w-0.5 h-3.5 rounded-full shrink-0"
          style={{ background: "var(--accent-file)" }}
        />
        <p
          className="text-[10px] font-mono tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          CODE REFERENCES
        </p>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-muted)",
            border: "1px solid var(--bg-border)",
          }}
        >
          {sources.length}
        </span>
      </div>

      {/* Horizontal scrollable card strip — fixed height, no vertical overflow */}
      <div
        className="overflow-x-auto overflow-y-hidden"
        style={{ height: 88 }}
      >
        <div
          className="flex flex-nowrap gap-2.5 px-4 py-2.5"
          style={{ width: "max-content", height: "100%" }}
        >
          {sources.map((src, i) => {
            const barWidth = Math.max(4, Math.round(src.relevance_score * 64));
            const scoreColor =
              src.relevance_score > 0.8
                ? "var(--accent-primary)"
                : src.relevance_score > 0.6
                ? "var(--accent-class)"
                : "var(--text-muted)";

            return (
              <div
                key={i}
                className="flex items-center gap-3 shrink-0 px-3 py-2 rounded-lg border transition-all"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: "var(--bg-border)",
                  width: 300,
                  height: 62,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.45)",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.55)";
                  (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.45)";
                  (e.currentTarget as HTMLDivElement).style.borderColor = "var(--bg-border)";
                }}
              >
                {/* Dot */}
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: "var(--accent-function)",
                    boxShadow: "0 0 6px rgba(59,130,246,0.5)",
                  }}
                />

                {/* Name + file */}
                <div className="flex-1 min-w-0">
                  <p
                    className="font-mono text-xs font-medium truncate"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {src.name}
                  </p>
                  <p
                    className="font-mono text-[10px] truncate mt-0.5"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {src.file.split("/").slice(-2).join("/")} :{src.start_line}–{src.end_line}
                  </p>
                </div>

                {/* Relevance bar */}
                <div
                  className="rounded-full shrink-0"
                  style={{
                    width: 64,
                    height: 3,
                    background: "var(--bg-border)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: barWidth,
                      background: "linear-gradient(90deg, var(--accent-primary), var(--accent-hover))",
                    }}
                  />
                </div>

                {/* Score */}
                <span
                  className="font-mono text-[10px] shrink-0 font-medium tabular-nums"
                  style={{ color: scoreColor, width: 28, textAlign: "right" }}
                >
                  {src.relevance_score.toFixed(2)}
                </span>

                {/* View button */}
                <button
                  onClick={() => setOpenSource(src)}
                  className="shrink-0 flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border transition-all"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--bg-border)",
                    color: "var(--text-secondary)",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = "var(--accent-primary)";
                    e.currentTarget.style.color = "var(--accent-primary)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = "var(--bg-border)";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                >
                  View <ExternalLink size={8} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Code viewer — portal ensures it renders at body level above everything */}
      {openSource && (
        <CodeViewerSheet
          source={openSource}
          onClose={() => setOpenSource(null)}
        />
      )}
    </>
  );
}

// ── Portal-based slide-in drawer ─────────────────────────────────────────────

function CodeViewerSheet({
  source,
  onClose,
}: {
  source: SourceReference;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Blurred backdrop — covers full page */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100,
          background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(4px)",
        }}
        onClick={onClose}
      />

      {/* Right-side sheet — slides in from right */}
      <div
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 101,
          width: 520,
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--glass-border)",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Sheet header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--bg-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(17,17,17,0.95)",
            backdropFilter: "blur(8px)",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              className="font-mono text-sm font-semibold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {source.name}
            </h2>
            <p
              className="font-mono text-[10px] mt-0.5 truncate"
              style={{ color: "var(--text-secondary)" }}
            >
              {source.file} · lines {source.start_line}–{source.end_line}
            </p>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-sm flex items-center justify-center rounded border transition-all"
            style={{
              width: 28,
              height: 28,
              borderColor: "var(--bg-border)",
              color: "var(--text-muted)",
              background: "var(--bg-elevated)",
              flexShrink: 0,
              marginLeft: 12,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "var(--text-secondary)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "var(--bg-border)";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable code content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          <CodeSnippet
            name={source.name}
            file={source.file}
            start_line={source.start_line}
            end_line={source.end_line}
            code={source.code}
          />
        </div>
      </div>
    </>,
    document.body
  );
}
