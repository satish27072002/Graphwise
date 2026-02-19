"use client";

import { useState } from "react";
import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";

interface FunctionNodeData {
  name: string;
  file: string;
  start_line: number;
  end_line?: number;
  complexity?: number;
  highlighted: boolean;
}

export function FunctionNode({ data }: NodeProps<FunctionNodeData>) {
  const [hovered, setHovered] = useState(false);
  const fileName = data.file ? data.file.split("/").pop() : "";

  const isHighlighted = data.highlighted;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: isHighlighted
          ? "linear-gradient(135deg, #1e293b 0%, var(--bg-surface) 100%)"
          : "var(--bg-surface)",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.12)" : "var(--bg-border)"}`,
        borderLeft: "3px solid var(--accent-function)",
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 200,
        maxWidth: 280,
        opacity: isHighlighted ? 1 : 0.75,
        boxShadow: isHighlighted
          ? hovered
            ? "0 0 0 1px rgba(59,130,246,0.6), 0 0 28px rgba(59,130,246,0.22), 0 4px 12px rgba(0,0,0,0.55)"
            : "0 0 0 1px rgba(59,130,246,0.45), 0 0 20px rgba(59,130,246,0.16), 0 2px 8px rgba(0,0,0,0.5)"
          : hovered
            ? "0 4px 12px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.35)"
            : "0 1px 3px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3)",
        transform: hovered ? "scale(1.02) translateY(-1px)" : "scale(1)",
        transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease, opacity 150ms ease",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <p
        className="font-mono font-medium truncate"
        style={{ fontSize: 13, color: "var(--text-primary)", letterSpacing: "-0.01em" }}
        title={data.name}
      >
        <span style={{ color: "var(--accent-function)", marginRight: 5 }}>ƒ</span>
        {data.name}
      </p>

      <p
        className="font-mono truncate mt-0.5"
        style={{ fontSize: 11, color: "var(--text-secondary)" }}
        title={data.file}
      >
        {fileName}
        {data.start_line ? (
          <span style={{ color: "var(--text-muted)" }}>
            {" "}:{data.start_line}
            {data.end_line && data.end_line !== data.start_line ? `–${data.end_line}` : ""}
          </span>
        ) : null}
      </p>

      {data.complexity !== undefined && data.complexity > 1 && (
        <p
          className="font-mono mt-1"
          style={{
            fontSize: 10,
            color: data.complexity > 10
              ? "#ef4444"
              : data.complexity > 5
              ? "#f59e0b"
              : "var(--text-muted)",
          }}
        >
          complexity: {data.complexity}
        </p>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
