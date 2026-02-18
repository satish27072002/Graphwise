"use client";

import { useState } from "react";
import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";

interface ModuleNodeData {
  name: string;
  type?: "internal" | "external";
  highlighted: boolean;
}

export function ModuleNode({ data }: NodeProps<ModuleNodeData>) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: data.highlighted ? "var(--bg-elevated)" : "var(--bg-surface)",
        border: "1px solid var(--bg-border)",
        borderLeft: "3px solid var(--accent-module)",
        borderRadius: 6,
        padding: "10px 14px",
        minWidth: 160,
        maxWidth: 240,
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
        title={data.name}
      >
        ○ {data.name}
      </p>

      <p
        className="font-mono mt-0.5"
        style={{ fontSize: 11, color: "var(--text-secondary)" }}
      >
        {data.type ?? "external"}
      </p>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
