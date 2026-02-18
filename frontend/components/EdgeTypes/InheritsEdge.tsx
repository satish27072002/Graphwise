"use client";

// INHERITS edge: solid line (purple) with hollow diamond at source + arrowhead at target.
// The hollow diamond is rendered as an inline SVG marker via a <defs> block.
// Label "INHERITS" appears on hover.

import { useState } from "react";
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from "reactflow";

export function InheritsEdge({
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

  // Unique marker ID per edge instance to avoid SVG defs collisions in React Flow
  const diamondId = `diamond-inherits-${id}`;

  return (
    <>
      {/* Inline SVG defs for the hollow diamond marker */}
      <defs>
        <marker
          id={diamondId}
          markerWidth="10"
          markerHeight="10"
          refX="5"
          refY="5"
          orient="auto-start-reverse"
        >
          {/* Hollow diamond: white/transparent fill with purple stroke */}
          <polygon
            points="5,1 9,5 5,9 1,5"
            fill="var(--bg-base)"
            stroke="var(--edge-inherits)"
            strokeWidth="1"
          />
        </marker>
      </defs>

      {/* Invisible wider hit area for hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {/* Visible solid line with hollow diamond at source + arrowhead at target */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke="var(--edge-inherits)"
        strokeWidth={1.5}
        style={{ opacity: hovered ? 1 : 0.55 }}
        markerStart={`url(#${diamondId})`}
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
                color: "var(--edge-inherits)",
                whiteSpace: "nowrap",
              }}
            >
              INHERITS
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
