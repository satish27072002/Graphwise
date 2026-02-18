"use client";

import { useState } from "react";
import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";

interface FileNodeData {
  name: string;
  file: string;
  loc?: number;
  language?: string;
  highlighted: boolean;
}

export function FileNode({ data }: NodeProps<FileNodeData>) {
  const [hovered, setHovered] = useState(false);
  const fileName = (data.file || data.name || "").split("/").pop() || data.name;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: data.highlighted ? "var(--bg-elevated)" : "var(--bg-surface)",
        border: "1px solid var(--bg-border)",
        borderLeft: "3px solid var(--accent-file)",
        borderRadius: 6,
        padding: "10px 14px",
        minWidth: 200,
        maxWidth: 280,
        opacity: data.highlighted ? 1 : 0.45,
        boxShadow: data.highlighted
          ? "0 0 0 1px var(--accent-primary), 0 0 20px var(--highlight-glow)"
          : "none",
        transform: hovered ? "scale(1.02)" : "scale(1)",
        transition: "transform 150ms ease",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <p
        className="font-mono font-medium truncate"
        style={{ fontSize: 13, color: "var(--text-primary)" }}
        title={data.file || data.name}
      >
        ▣ {fileName}
      </p>

      <p
        className="font-mono mt-0.5"
        style={{ fontSize: 11, color: "var(--text-secondary)" }}
      >
        {data.loc ? `${data.loc} lines` : ""}
        {data.loc && data.language ? " · " : ""}
        {data.language ?? "Python"}
      </p>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
