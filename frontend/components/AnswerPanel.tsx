"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import type { QueryResponse } from "@/types";

interface AnswerPanelProps {
  response: QueryResponse | null;
  isLoading?: boolean;
}

function SkeletonLine({ width = "100%", delay = 0 }: { width?: string; delay?: number }) {
  return (
    <div
      className="rounded-md animate-pulse"
      style={{
        background: "var(--bg-elevated)",
        height: 13,
        width,
        marginBottom: 9,
        animationDelay: `${delay}ms`,
      }}
    />
  );
}

export function AnswerPanel({ response, isLoading }: AnswerPanelProps) {
  const [cypherOpen, setCypherOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyCypher = () => {
    if (response?.cypher_used) {
      navigator.clipboard.writeText(response.cypher_used);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Loading skeleton ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-5 space-y-2 overflow-auto h-full">
        {/* Header */}
        <div
          className="flex items-center gap-2 pb-3 mb-4 border-b"
          style={{ borderColor: "var(--bg-border)" }}
        >
          <div
            className="w-0.5 h-4 rounded-full"
            style={{ background: "var(--accent-primary)" }}
          />
          <p className="text-xs font-mono" style={{ color: "var(--text-muted)", letterSpacing: "0.08em" }}>
            ANSWER
          </p>
        </div>
        <SkeletonLine delay={0} />
        <SkeletonLine width="92%" delay={50} />
        <SkeletonLine width="78%" delay={100} />
        <SkeletonLine delay={150} />
        <SkeletonLine width="88%" delay={200} />
        <SkeletonLine width="64%" delay={250} />
        <div style={{ height: 12 }} />
        <SkeletonLine width="45%" delay={300} />
      </div>
    );
  }

  if (!response) {
    return (
      <div className="h-full flex items-center justify-center p-5">
        <div className="text-center">
          <p className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>
            Ask a question to see the answer
          </p>
          <p className="text-xs font-mono mt-1" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
            Results appear here after a query
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {/* Panel header */}
      <div
        className="px-5 pt-4 pb-3 border-b sticky top-0 z-10"
        style={{
          borderColor: "var(--bg-border)",
          background: "rgba(17,17,17,0.95)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-0.5 h-4 rounded-full"
            style={{ background: "var(--accent-primary)" }}
          />
          <p className="text-xs font-mono tracking-widest" style={{ color: "var(--text-muted)" }}>
            ANSWER
          </p>
        </div>
      </div>

      {/* Answer content */}
      <div className="px-5 py-4">
        <div
          className="text-sm leading-relaxed"
          style={{ color: "var(--text-primary)" }}
        >
          <ReactMarkdown
            components={{
              code({ node, className, children, ...props }) {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <pre
                      className="rounded-lg p-3.5 overflow-x-auto text-xs font-mono my-3"
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--bg-border)",
                        color: "var(--text-primary)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    >
                      <code>{children}</code>
                    </pre>
                  );
                }
                return (
                  <code
                    className="font-mono text-xs px-1.5 py-0.5 rounded"
                    style={{
                      background: "rgba(59,130,246,0.1)",
                      color: "var(--accent-function)",
                      border: "1px solid rgba(59,130,246,0.15)",
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
                  <p className="mb-3" style={{ color: "var(--text-primary)", lineHeight: 1.7 }}>
                    {children}
                  </p>
                );
              },
              ul({ children }) {
                return (
                  <ul
                    className="list-none mb-3 space-y-1.5"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {children}
                  </ul>
                );
              },
              li({ children }) {
                return (
                  <li className="flex items-start gap-2" style={{ color: "var(--text-primary)" }}>
                    <span style={{ color: "var(--accent-primary)", marginTop: 2, flexShrink: 0 }}>›</span>
                    <span>{children}</span>
                  </li>
                );
              },
              ol({ children }) {
                return (
                  <ol
                    className="list-decimal list-inside mb-3 space-y-1.5"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {children}
                  </ol>
                );
              },
              h1({ children }) {
                return <h1 className="text-base font-semibold mb-2 mt-4" style={{ color: "var(--text-primary)" }}>{children}</h1>;
              },
              h2({ children }) {
                return <h2 className="text-sm font-semibold mb-2 mt-3" style={{ color: "var(--text-primary)" }}>{children}</h2>;
              },
              h3({ children }) {
                return <h3 className="text-sm font-medium mb-1 mt-2" style={{ color: "var(--text-secondary)" }}>{children}</h3>;
              },
            }}
          >
            {response.answer}
          </ReactMarkdown>
        </div>

        {/* Metadata line */}
        <div
          className="mt-5 pt-4 border-t flex items-center gap-2 flex-wrap"
          style={{ borderColor: "var(--bg-border)" }}
        >
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded"
            style={{
              background: "rgba(59,130,246,0.1)",
              color: "var(--accent-primary)",
              border: "1px solid rgba(59,130,246,0.15)",
            }}
          >
            {response.retrieval_method}
          </span>

          {response.sources.length > 0 && (
            <span
              className="text-[10px] font-mono"
              style={{ color: "var(--text-muted)" }}
            >
              · {response.sources.length} sources
            </span>
          )}
        </div>

        {/* Collapsible Cypher viewer */}
        {response.cypher_used && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setCypherOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs font-mono transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--text-secondary)")}
              >
                {cypherOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                View Generated Cypher
              </button>

              {cypherOpen && (
                <button
                  onClick={handleCopyCypher}
                  className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border transition-all"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--bg-border)",
                    color: copied ? "var(--accent-file)" : "var(--text-muted)",
                  }}
                >
                  {copied ? <Check size={9} /> : <Copy size={9} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
            </div>

            {cypherOpen && (
              <pre
                className="mt-2 rounded-lg p-3.5 text-xs font-mono overflow-x-auto"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--bg-border)",
                  color: "var(--accent-module)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
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
