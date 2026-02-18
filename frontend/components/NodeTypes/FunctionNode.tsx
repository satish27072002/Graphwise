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

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: data.highlighted ? "var(--bg-elevated)" : "var(--bg-surface)",
        border: "1px solid var(--bg-border)",
        borderLeft: "3px solid var(--accent-function)",
        borderRadius: 6,
        padding: "10px 14px",
        minWidth: 200,
        maxWidth: 280,
        opacity: data.highlighted ? 1 : 0.45,
        boxShadow: data.highlighted
          ? "0 0 0 1px var(--accent-primary), 0 0 20px var(--highlight-glow)"
          : "none",
        transform: hovered ? "scale(1.02)" : "scale(1)",
        transition: "transform 150ms ease, box-shadow 150ms ease",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <p
        className="font-mono font-medium truncate"
        style={{ fontSize: 13, color: "var(--text-primary)" }}
        title={data.name}
      >
        ▌ {data.name}
      </p>

      <p
        className="font-mono truncate mt-0.5"
        style={{ fontSize: 11, color: "var(--text-secondary)" }}
        title={data.file}
      >
        {fileName} : {data.start_line}
        {data.end_line && data.end_line !== data.start_line ? `–${data.end_line}` : ""}
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
