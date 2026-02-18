"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

import { FunctionNode } from "@/components/NodeTypes/FunctionNode";
import { ClassNode } from "@/components/NodeTypes/ClassNode";
import { FileNode } from "@/components/NodeTypes/FileNode";
import { ModuleNode } from "@/components/NodeTypes/ModuleNode";
import { CallsEdge } from "@/components/EdgeTypes/CallsEdge";
import { ImportsEdge } from "@/components/EdgeTypes/ImportsEdge";
import { InheritsEdge } from "@/components/EdgeTypes/InheritsEdge";
import type { GraphData, EdgeType } from "@/types";

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
  CALLS: "var(--edge-calls)",
  IMPORTS: "var(--edge-imports)",
  INHERITS: "var(--edge-inherits)",
  CONTAINS: "var(--edge-contains)",
  HAS_METHOD: "var(--edge-contains)",
};

function toReactFlowNodes(graphNodes: GraphData["nodes"]): Node[] {
  return graphNodes.map(n => ({
    id: n.id,
    type: n.type,
    position: { x: 0, y: 0 },  // dagre layout handled by fitView
    data: { ...n },
  }));
}

function toReactFlowEdges(graphEdges: GraphData["edges"], hiddenTypes: Set<EdgeType>): Edge[] {
  return graphEdges
    .filter(e => !hiddenTypes.has(e.type as EdgeType))
    .map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: (e.type === "CALLS" || e.type === "IMPORTS" || e.type === "INHERITS")
        ? e.type
        : undefined,
      data: { line_number: e.line_number },
    }));
}

// ── Inner canvas (needs ReactFlowProvider context) ──────────────────────────

interface InnerProps {
  graph: GraphData;
  onNodeClick?: (nodeId: string) => void;
}

function GraphCanvasInner({ graph, onNodeClick }: InnerProps) {
  const { fitView } = useReactFlow();
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<EdgeType>>(new Set());

  const rfNodes = useMemo(() => toReactFlowNodes(graph.nodes), [graph.nodes]);
  const rfEdges = useMemo(() => toReactFlowEdges(graph.edges, hiddenEdgeTypes), [graph.edges, hiddenEdgeTypes]);

  // Fit view to highlighted nodes when graph changes
  useEffect(() => {
    if (rfNodes.length === 0) return;
    const highlightedIds = graph.nodes
      .filter(n => n.highlighted)
      .map(n => n.id);

    setTimeout(() => {
      fitView({
        nodes: highlightedIds.length > 0
          ? rfNodes.filter(n => highlightedIds.includes(n.id))
          : rfNodes,
        padding: 0.2,
        duration: 300,
      });
    }, 50);
  }, [rfNodes, graph.nodes, fitView]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
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

  if (graph.nodes.length === 0) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ background: "var(--bg-base)" }}
      >
        <p className="font-mono text-sm" style={{ color: "var(--text-muted)" }}>
          Graph will appear here after a query
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative" style={{ background: "var(--bg-base)" }}>
      {/* Edge filter pills */}
      <div className="absolute top-3 left-3 z-10 flex gap-2 flex-wrap">
        {ALL_EDGE_TYPES.map(type => {
          const isActive = !hiddenEdgeTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleEdgeType(type)}
              className="text-[10px] font-mono px-2 py-1 rounded-full border transition-all"
              style={{
                background: isActive ? EDGE_COLORS[type] : "var(--bg-surface)",
                borderColor: isActive ? EDGE_COLORS[type] : "var(--bg-border)",
                color: isActive ? "#fff" : "var(--text-muted)",
                opacity: isActive ? 1 : 0.5,
              }}
            >
              {type}
            </button>
          );
        })}
      </div>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        style={{ background: "var(--bg-base)" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#1f1f1f"
          gap={20}
          size={1}
        />
        <Controls
          position="bottom-left"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--bg-border)",
          }}
        />
        <MiniMap
          position="bottom-right"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--bg-border)",
          }}
          nodeColor={n => {
            const type = (n.data as { type?: string }).type;
            switch (type) {
              case "Function": return "var(--accent-function)";
              case "Class":    return "var(--accent-class)";
              case "File":     return "var(--accent-file)";
              case "Module":   return "var(--accent-module)";
              default:         return "var(--text-muted)";
            }
          }}
          maskColor="rgba(8, 8, 8, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}

// ── Public component wrapped in ReactFlowProvider ───────────────────────────

interface GraphCanvasProps {
  graph: GraphData;
  onNodeClick?: (nodeId: string) => void;
}

export function GraphCanvas({ graph, onNodeClick }: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner graph={graph} onNodeClick={onNodeClick} />
    </ReactFlowProvider>
  );
}
