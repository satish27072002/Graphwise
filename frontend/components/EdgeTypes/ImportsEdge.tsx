"use client";

// IMPORTS edge: solid line (orange) with arrowhead at target.
// Label "IMPORTS" appears on hover.

import { useState } from "react";
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from "reactflow";

export function ImportsEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  return (
    <>
      {/* Invisible wider hit area for hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {/* Visible solid line */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke="var(--edge-imports)"
        strokeWidth={1.5}
        style={{ opacity: hovered ? 1 : 0.55 }}
        markerEnd="url(#react-flow__arrowclosed)"
      />

      {/* Hover label */}
      {hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--bg-border)",
                color: "var(--edge-imports)",
                whiteSpace: "nowrap",
              }}
            >
              IMPORTS
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
