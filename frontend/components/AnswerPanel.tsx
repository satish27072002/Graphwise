"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { QueryResponse } from "@/types";

interface AnswerPanelProps {
  response: QueryResponse | null;
  isLoading?: boolean;
}

function SkeletonLine({ width = "100%" }: { width?: string }) {
  return (
    <div
      className="rounded animate-pulse"
      style={{
        background: "var(--bg-elevated)",
        height: 14,
        width,
        marginBottom: 8,
      }}
    />
  );
}

export function AnswerPanel({ response, isLoading }: AnswerPanelProps) {
  const [cypherOpen, setCypherOpen] = useState(false);

  // ── Loading skeleton ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-5 space-y-3 overflow-auto h-full">
        <p className="text-xs font-mono mb-4" style={{ color: "var(--text-muted)" }}>
          ANSWER
        </p>
        <SkeletonLine />
        <SkeletonLine width="90%" />
        <SkeletonLine width="75%" />
        <SkeletonLine />
        <SkeletonLine width="85%" />
        <SkeletonLine width="60%" />
      </div>
    );
  }

  if (!response) {
    return (
      <div className="h-full flex items-center justify-center p-5">
        <p className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>
          Ask a question to see the answer here
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {/* Panel header */}
      <div
        className="px-5 pt-4 pb-2 border-b"
        style={{ borderColor: "var(--bg-border)" }}
      >
        <p className="text-xs font-mono tracking-widest" style={{ color: "var(--text-muted)" }}>
          ANSWER
        </p>
      </div>

      {/* Answer content */}
      <div className="px-5 py-4">
        <div
          className="prose prose-sm max-w-none text-sm leading-relaxed"
          style={{ color: "var(--text-primary)" }}
        >
          <ReactMarkdown
            components={{
              code({ node, className, children, ...props }) {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <pre
                      className="rounded-md p-3 overflow-x-auto text-xs font-mono"
                      style={{
                        background: "var(--bg-surface)",
                        border: "1px solid var(--bg-border)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <code>{children}</code>
                    </pre>
                  );
                }
                return (
                  <code
                    className="font-mono text-xs px-1 py-0.5 rounded"
                    style={{
                      background: "var(--bg-elevated)",
                      color: "var(--accent-function)",
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              strong({ children }) {
                return (
                  <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {children}
                  </strong>
                );
              },
              p({ children }) {
                return (
                  <p className="mb-3" style={{ color: "var(--text-primary)" }}>
                    {children}
                  </p>
                );
              },
              ul({ children }) {
                return (
                  <ul
                    className="list-disc list-inside mb-3 space-y-1"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {children}
                  </ul>
                );
              },
              ol({ children }) {
                return (
                  <ol
                    className="list-decimal list-inside mb-3 space-y-1"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {children}
                  </ol>
                );
              },
            }}
          >
            {response.answer}
          </ReactMarkdown>
        </div>

        {/* Metadata line */}
        <p
          className="mt-4 text-xs font-mono"
          style={{ color: "var(--text-muted)" }}
        >
          Retrieved via: {response.retrieval_method}
          {response.sources.length > 0 && ` · ${response.sources.length} sources`}
        </p>

        {/* Collapsible Cypher viewer */}
        {response.cypher_used && (
          <div className="mt-4">
            <button
              onClick={() => setCypherOpen(o => !o)}
              className="flex items-center gap-1 text-xs font-mono transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              {cypherOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              View Generated Cypher
            </button>
            {cypherOpen && (
              <pre
                className="mt-2 rounded-md p-3 text-xs font-mono overflow-x-auto"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--bg-border)",
                  color: "var(--accent-module)",
                }}
              >
                {response.cypher_used}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
