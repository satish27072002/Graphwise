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

  const isHighlighted = data.highlighted;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: isHighlighted
          ? "linear-gradient(135deg, #160d24 0%, var(--bg-surface) 100%)"
          : "var(--bg-surface)",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.12)" : "var(--bg-border)"}`,
        borderLeft: "3px solid var(--accent-module)",
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 160,
        maxWidth: 240,
        opacity: isHighlighted ? 1 : 0.75,
        boxShadow: isHighlighted
          ? hovered
            ? "0 0 0 1px rgba(139,92,246,0.6), 0 0 28px rgba(139,92,246,0.22), 0 4px 12px rgba(0,0,0,0.55)"
            : "0 0 0 1px rgba(139,92,246,0.45), 0 0 20px rgba(139,92,246,0.16), 0 2px 8px rgba(0,0,0,0.5)"
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
        <span style={{ color: "var(--accent-module)", marginRight: 5 }}>○</span>
        {data.name}
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
