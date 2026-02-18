"use client";

// CALLS edge: animated dashed line (light blue) with arrowhead at target.
// Label "CALLS · line N" appears on hover.

import { useState } from "react";
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from "reactflow";

export function CallsEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  const lineNumber = (data as { line_number?: number } | undefined)?.line_number;
  const label = lineNumber ? `CALLS · line ${lineNumber}` : "CALLS";

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

      {/* Visible animated dashed line */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke="var(--edge-calls)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        style={{
          animation: "dash-flow 0.6s linear infinite",
          opacity: hovered ? 1 : 0.6,
        }}
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
                color: "var(--edge-calls)",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
