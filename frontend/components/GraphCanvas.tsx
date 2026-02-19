"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  NodeTypes,
  EdgeTypes,
  Node,
  Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";

import { FunctionNode } from "@/components/NodeTypes/FunctionNode";
import { ClassNode } from "@/components/NodeTypes/ClassNode";
import { FileNode } from "@/components/NodeTypes/FileNode";
import { ModuleNode } from "@/components/NodeTypes/ModuleNode";
import { CallsEdge } from "@/components/EdgeTypes/CallsEdge";
import { ImportsEdge } from "@/components/EdgeTypes/ImportsEdge";
import { InheritsEdge } from "@/components/EdgeTypes/InheritsEdge";
import type { GraphData, EdgeType } from "@/types";
import {
  type VisualizationMode,
  VIZ_MODE_LABELS,
  VIZ_MODE_COLORS,
} from "@/lib/vizMode";

const nodeTypes: NodeTypes = {
  Function: FunctionNode,
  Class: ClassNode,
  File: FileNode,
  Module: ModuleNode,
};

const edgeTypes: EdgeTypes = {
  CALLS: CallsEdge,
  IMPORTS: ImportsEdge,
  INHERITS: InheritsEdge,
};

const ALL_EDGE_TYPES: EdgeType[] = ["CALLS", "IMPORTS", "INHERITS", "CONTAINS"];

const EDGE_COLORS: Record<EdgeType, string> = {
  CALLS: "#60a5fa",
  IMPORTS: "#fb923c",
  INHERITS: "#a78bfa",
  CONTAINS: "#4b5563",
  HAS_METHOD: "#4b5563",
};

// Mode icons
const VIZ_MODE_ICONS: Record<VisualizationMode, string> = {
  flow: "⟶",
  impact: "◎",
  dependency: "⤵",
};

// ── Layout algorithms ──────────────────────────────────────────────────────

const NODE_W = 220;
const NODE_H = 70;

function dagreLayout(
  nodes: GraphData["nodes"],
  edges: GraphData["edges"],
  direction: "LR" | "TB",
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 120, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });

  dagre.layout(g);

  return nodes.map(n => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: n.type,
      position: {
        x: (pos?.x ?? 0) - NODE_W / 2,
        y: (pos?.y ?? 0) - NODE_H / 2,
      },
      data: { ...n },
    };
  });
}

function radialLayout(nodes: GraphData["nodes"]): Node[] {
  if (nodes.length === 0) return [];

  // Center node = first highlighted node
  const highlighted = nodes.filter(n => n.highlighted);
  const center = highlighted[0] ?? nodes[0];
  const neighbors = nodes.filter(n => n.id !== center.id && n.highlighted);
  const outer = nodes.filter(n => n.id !== center.id && !n.highlighted);

  const positioned: Node[] = [];

  // Center node at origin
  positioned.push({
    id: center.id,
    type: center.type,
    position: { x: -NODE_W / 2, y: -NODE_H / 2 },
    data: { ...center },
  });

  // Ring 1 — direct neighbors (highlighted), radius 300
  const r1 = 300;
  neighbors.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(neighbors.length, 1) - Math.PI / 2;
    positioned.push({
      id: n.id,
      type: n.type,
      position: {
        x: Math.round(r1 * Math.cos(angle)) - NODE_W / 2,
        y: Math.round(r1 * Math.sin(angle)) - NODE_H / 2,
      },
      data: { ...n },
    });
  });

  // Ring 2 — non-highlighted, radius 560
  const r2 = 560;
  outer.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(outer.length, 1) - Math.PI / 2;
    positioned.push({
      id: n.id,
      type: n.type,
      position: {
        x: Math.round(r2 * Math.cos(angle)) - NODE_W / 2,
        y: Math.round(r2 * Math.sin(angle)) - NODE_H / 2,
      },
      data: { ...n },
    });
  });

  return positioned;
}

function applyLayout(
  nodes: GraphData["nodes"],
  edges: GraphData["edges"],
  mode: VisualizationMode,
): Node[] {
  if (nodes.length === 0) return [];
  if (mode === "impact") return radialLayout(nodes);
  if (mode === "dependency") return dagreLayout(nodes, edges, "TB");
  return dagreLayout(nodes, edges, "LR");
}

// ── Edge builder ───────────────────────────────────────────────────────────

function toReactFlowEdges(
  graphEdges: GraphData["edges"],
  hiddenTypes: Set<EdgeType>,
  centerId: string | null,
  mode: VisualizationMode,
): Edge[] {
  return graphEdges
    .filter(e => !hiddenTypes.has(e.type as EdgeType))
    .map(e => {
      const isImpactEdge =
        mode === "impact" && (e.source === centerId || e.target === centerId);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type:
          e.type === "CALLS" || e.type === "IMPORTS" || e.type === "INHERITS"
            ? e.type
            : undefined,
        data: {
          line_number: e.line_number,
          impactColor: isImpactEdge ? "#ef4444" : undefined,
        },
        style: {
          opacity: mode === "impact" ? (isImpactEdge ? 1 : 0.2) : 1,
        },
      };
    });
}

// ── Inner canvas ───────────────────────────────────────────────────────────

interface InnerProps {
  graph: GraphData;
  vizMode: VisualizationMode;
  onVizModeChange: (mode: VisualizationMode) => void;
  onNodeClick?: (nodeId: string) => void;
}

const VIZ_CYCLE: VisualizationMode[] = ["flow", "impact", "dependency"];

function GraphCanvasInner({ graph, vizMode, onVizModeChange, onNodeClick }: InnerProps) {
  const { fitView } = useReactFlow();
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<EdgeType>>(new Set());
  const prevNodeCount = useRef(0);

  // Center node ID for impact mode
  const centerId = useMemo(
    () => graph.nodes.find(n => n.highlighted)?.id ?? null,
    [graph.nodes],
  );

  // Recompute layout when graph size or mode changes
  const rfNodes = useMemo(
    () => applyLayout(graph.nodes, graph.edges, vizMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph.nodes.length, graph.edges.length, vizMode],
  );

  const rfEdges = useMemo(
    () => toReactFlowEdges(graph.edges, hiddenEdgeTypes, centerId, vizMode),
    [graph.edges, hiddenEdgeTypes, centerId, vizMode],
  );

  // Fit view when graph changes
  useEffect(() => {
    if (rfNodes.length === 0) return;
    const isNewGraph = rfNodes.length !== prevNodeCount.current;
    prevNodeCount.current = rfNodes.length;

    const highlightedIds = graph.nodes.filter(n => n.highlighted).map(n => n.id);
    const targetNodes =
      highlightedIds.length > 0
        ? rfNodes.filter(n => highlightedIds.includes(n.id))
        : rfNodes;

    setTimeout(() => {
      fitView({ nodes: targetNodes, padding: 0.25, duration: isNewGraph ? 300 : 0 });
    }, 60);
  }, [rfNodes, graph.nodes, fitView]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onNodeClick?.(node.id),
    [onNodeClick],
  );

  const toggleEdgeType = (type: EdgeType) => {
    setHiddenEdgeTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const cycleVizMode = () => {
    const idx = VIZ_CYCLE.indexOf(vizMode);
    onVizModeChange(VIZ_CYCLE[(idx + 1) % VIZ_CYCLE.length]);
  };

  // ── Empty state ────────────────────────────────────────────────────────
  if (graph.nodes.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4"
        style={{ width: "100%", height: "100%", background: "var(--bg-base)" }}
      >
        {/* Animated graph icon */}
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          fill="none"
          className="node-pulse"
        >
          <circle cx="10" cy="28" r="6" fill="var(--accent-function)" />
          <circle cx="46" cy="12" r="6" fill="var(--accent-class)" />
          <circle cx="46" cy="44" r="6" fill="var(--accent-file)" />
          <circle cx="28" cy="28" r="4" fill="var(--accent-module)" opacity="0.6" />
          <line x1="16"  y1="28" x2="22"  y2="28" stroke="var(--bg-border)" strokeWidth="1.5" />
          <line x1="32"  y1="26" x2="40"  y2="14" stroke="var(--bg-border)" strokeWidth="1.5" />
          <line x1="32"  y1="30" x2="40"  y2="42" stroke="var(--bg-border)" strokeWidth="1.5" />
        </svg>

        <div className="text-center">
          <p className="font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            Query a codebase to explore its graph
          </p>
          <p className="font-mono text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Nodes and relationships will appear here
          </p>
        </div>
      </div>
    );
  }

  // Find center node React Flow position for impact overlay
  const centerRfNode = vizMode === "impact" ? rfNodes.find(n => n.id === centerId) : null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--bg-base)",
        position: "relative",
      }}
    >

      {/* Impact burst — pulsing danger ring behind center node */}
      {centerRfNode && (
        <div
          className="impact-ring pointer-events-none absolute"
          style={{
            left: "50%",
            top: "50%",
            width: 140,
            height: 140,
            marginLeft: -70,
            marginTop: -70,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(239,68,68,0.25) 0%, transparent 70%)",
            border: "2px solid rgba(239,68,68,0.5)",
            zIndex: 5,
          }}
        />
      )}

      {/* Edge filter pills — top left */}
      <div className="absolute top-3 left-3 z-10 flex gap-1.5 flex-wrap">
        {ALL_EDGE_TYPES.map(type => {
          const isActive = !hiddenEdgeTypes.has(type);
          const color = EDGE_COLORS[type];
          return (
            <button
              key={type}
              onClick={() => toggleEdgeType(type)}
              className="text-[10px] font-mono px-2.5 py-1 rounded-full border transition-all"
              style={{
                background: isActive ? `${color}22` : "var(--bg-surface)",
                borderColor: isActive ? color : "var(--bg-border)",
                color: isActive ? color : "var(--text-muted)",
                boxShadow: isActive ? `0 0 8px ${color}33` : "none",
                opacity: isActive ? 1 : 0.45,
                letterSpacing: "0.04em",
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.opacity = "0.75";
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.opacity = "0.45";
              }}
            >
              {type}
            </button>
          );
        })}
      </div>

      {/* Visualization mode pill — top right */}
      <button
        onClick={cycleVizMode}
        className="absolute top-3 right-3 z-10 text-[10px] font-mono px-3 py-1 rounded-full border transition-all hover:brightness-115"
        style={{
          background: `${VIZ_MODE_COLORS[vizMode]}22`,
          borderColor: VIZ_MODE_COLORS[vizMode],
          color: VIZ_MODE_COLORS[vizMode],
          boxShadow: `0 0 10px ${VIZ_MODE_COLORS[vizMode]}33`,
          letterSpacing: "0.04em",
        }}
        title="Click to cycle: Flow → Impact → Dependency"
      >
        {VIZ_MODE_ICONS[vizMode]} {VIZ_MODE_LABELS[vizMode]}
      </button>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        style={{ background: "var(--bg-base)" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#1a1a1a"
          gap={24}
          size={1.2}
        />
        <Controls
          position="bottom-left"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--bg-border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-sm)",
          }}
        />
        <MiniMap
          position="bottom-right"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--glass-border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-sm)",
          }}
          nodeColor={n => {
            const t = (n.data as { type?: string }).type;
            if (t === "Function") return "#3b82f6";
            if (t === "Class")    return "#f59e0b";
            if (t === "File")     return "#10b981";
            if (t === "Module")   return "#8b5cf6";
            return "#444444";
          }}
          maskColor="rgba(8, 8, 8, 0.75)"
        />
      </ReactFlow>
    </div>
  );
}

// ── Public component wrapped in ReactFlowProvider ───────────────────────────

interface GraphCanvasProps {
  graph: GraphData;
  vizMode: VisualizationMode;
  onVizModeChange: (mode: VisualizationMode) => void;
  onNodeClick?: (nodeId: string) => void;
}

export function GraphCanvas({ graph, vizMode, onVizModeChange, onNodeClick }: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner
        graph={graph}
        vizMode={vizMode}
        onVizModeChange={onVizModeChange}
        onNodeClick={onNodeClick}
      />
    </ReactFlowProvider>
  );
}
