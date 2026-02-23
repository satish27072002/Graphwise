import { memo, useEffect, useMemo, useState } from "react";
import { GraphVisualization, type NeoNode, type NeoRel, type PortableProperty } from "@neo4j-ndl/react-graph";
import type { Node as NvlNode, Relationship as NvlRelationship } from "@neo4j-nvl/base";
import "@neo4j-ndl/base/lib/neo4j-ds-styles.css";
import { QuestionGraph } from "../types";

// ──────────────────────────────────────────────────────────
// Color palette — maps our node types to Neo4j-style hex colors
// ──────────────────────────────────────────────────────────
const NODE_COLORS: Record<string, string> = {
    question: "#f59e0b",   // amber
    file:     "#10b981",   // emerald
    class:    "#10b981",   // emerald
    function: "#34d399",   // lighter emerald
    code:     "#10b981",   // emerald
    concept:  "#06b6d4",   // cyan
    evidence: "#8b5cf6",   // violet
    entity:   "#06b6d4",   // cyan
};

const DEFAULT_COLOR = "#64748b"; // slate

// Node sizes by type (NVL size = approximate radius)
const NODE_SIZES: Record<string, number> = {
    question: 40,
    file:     28,
    class:    28,
    function: 22,
    code:     22,
    concept:  25,
    evidence: 18,
    entity:   25,
};

const DEFAULT_SIZE = 20;

function getNodeColor(type: string): string {
    return NODE_COLORS[type] ?? DEFAULT_COLOR;
}

function getNodeSize(type: string): number {
    return NODE_SIZES[type] ?? DEFAULT_SIZE;
}

// ──────────────────────────────────────────────────────────
// Transform our graph nodes → NeoNode (what GraphVisualization needs)
// ──────────────────────────────────────────────────────────
function toNeoNodes(nodes: QuestionGraph["nodes"]): NeoNode[] {
    return nodes.map((n) => {
        const nvlNode: NvlNode = {
            id: n.id,
            caption: n.label.length > 30 ? n.label.slice(0, 28) + "…" : n.label,
            color: getNodeColor(n.type),
            size: getNodeSize(n.type),
        };

        const properties: Record<string, PortableProperty> = {
            type:  { stringified: `"${n.type}"`, type: "string" },
            label: { stringified: `"${n.label}"`, type: "string" },
        };
        if (n.subtitle) {
            properties.path = { stringified: `"${n.subtitle}"`, type: "string" };
        }
        if (n.ref_id) {
            properties.ref_id = { stringified: `"${n.ref_id}"`, type: "string" };
        }

        return {
            ...nvlNode,
            labels: [n.type],
            properties,
        } as NeoNode;
    });
}

// ──────────────────────────────────────────────────────────
// Transform our graph edges → NeoRel
// ──────────────────────────────────────────────────────────
function toNeoRels(edges: QuestionGraph["edges"]): NeoRel[] {
    return edges.map((e) => {
        const nvlRel: NvlRelationship = {
            id: e.id,
            from: e.source,
            to: e.target,
            caption: e.label,
            color: "rgba(148,163,184,0.5)",
            width: 1.5,
        };

        return {
            ...nvlRel,
            type: e.label,
            properties: {
                label: { stringified: `"${e.label}"`, type: "string" },
            } as Record<string, PortableProperty>,
        } as NeoRel;
    });
}

// ──────────────────────────────────────────────────────────
// Apply NDL dark theme class to <html> element (required by NDL CSS)
// ──────────────────────────────────────────────────────────
function useNdlTheme() {
    useEffect(() => {
        document.documentElement.classList.add("ndl-theme-dark");
    }, []);
}

// ──────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────
interface QuestionGraphViewProps {
    graph: QuestionGraph;
    selectedNodeId: string | null;
    selectedEdgeId: string | null;
    onSelectNode: (nodeId: string) => void;
    onSelectEdge: (edgeId: string) => void;
}

// ──────────────────────────────────────────────────────────
// InteractiveQuestionGraph — Neo4j GraphVisualization powered
// ──────────────────────────────────────────────────────────
export const InteractiveQuestionGraph = memo(function InteractiveQuestionGraph({
    graph,
    selectedNodeId,
    selectedEdgeId,
    onSelectNode,
    onSelectEdge,
}: QuestionGraphViewProps) {
    useNdlTheme();

    const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
    const [sidePanelWidth, setSidePanelWidth] = useState(280);

    const neoNodes = useMemo(() => toNeoNodes(graph.nodes), [graph.nodes]);
    const neoRels  = useMemo(() => toNeoRels(graph.edges),  [graph.edges]);

    // Apply selection highlight: dim unconnected nodes/edges
    const displayNodes = useMemo(() => {
        if (!selectedNodeId) return neoNodes;
        const neighborIds = new Set<string>([selectedNodeId]);
        for (const e of graph.edges) {
            if (e.source === selectedNodeId) neighborIds.add(e.target);
            if (e.target === selectedNodeId) neighborIds.add(e.source);
        }
        return neoNodes.map((n) => ({
            ...n,
            activated: n.id === selectedNodeId,
            selected:  n.id === selectedNodeId,
            disabled:  !neighborIds.has(n.id),
        }));
    }, [neoNodes, selectedNodeId, graph.edges]);

    const displayRels = useMemo(() => {
        if (!selectedNodeId && !selectedEdgeId) return neoRels;
        return neoRels.map((r) => {
            const isConnected = r.from === selectedNodeId || r.to === selectedNodeId;
            const isSelected  = r.id === selectedEdgeId;
            return {
                ...r,
                activated: isSelected || isConnected,
                selected:  isSelected,
                disabled:  selectedNodeId ? !isConnected && !isSelected : false,
                color: isSelected
                    ? "#f43f5e"
                    : isConnected
                    ? "rgba(251,113,133,0.75)"
                    : "rgba(148,163,184,0.25)",
                width: isSelected ? 3 : isConnected ? 2 : 1,
            };
        });
    }, [neoRels, selectedNodeId, selectedEdgeId]);

    const legendItems = [
        { type: "question", label: "Question",     color: NODE_COLORS.question, size: 14 },
        { type: "file",     label: "File / Class", color: NODE_COLORS.file,     size: 10 },
        { type: "function", label: "Function",     color: NODE_COLORS.function, size: 7  },
        { type: "concept",  label: "Concept",      color: NODE_COLORS.concept,  size: 8  },
        { type: "evidence", label: "Evidence",     color: NODE_COLORS.evidence, size: 6  },
    ];

    return (
        <div
            className="neo4j-graph-container"
            style={{
                width: "100%",
                height: "100%",
                minHeight: 500,
                position: "relative",
                borderRadius: "12px",
                overflow: "hidden",
                background: "#0f172a",
            }}
        >
            {/* Legend */}
            <div
                style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    zIndex: 10,
                    display: "flex",
                    gap: 12,
                    background: "rgba(15,23,42,0.88)",
                    border: "1px solid rgba(148,163,184,0.15)",
                    borderRadius: 10,
                    padding: "8px 14px",
                    backdropFilter: "blur(8px)",
                    flexWrap: "wrap",
                }}
            >
                {legendItems.map(({ type, label, color, size }) => (
                    <div key={type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "#cbd5e1" }}>
                        <div style={{
                            width: size,
                            height: size,
                            borderRadius: "50%",
                            background: color,
                            boxShadow: `0 0 6px ${color}88`,
                            flexShrink: 0,
                        }} />
                        {label}
                    </div>
                ))}
            </div>

            {/* Hint */}
            <div
                style={{
                    position: "absolute",
                    bottom: 12,
                    left: 12,
                    zIndex: 10,
                    fontSize: 11,
                    color: "#64748b",
                    background: "rgba(15,23,42,0.75)",
                    border: "1px solid rgba(148,163,184,0.10)",
                    borderRadius: 8,
                    padding: "5px 10px",
                    backdropFilter: "blur(6px)",
                }}
            >
                Scroll to zoom · Drag to pan · Click node to inspect
            </div>

            {/* Neo4j GraphVisualization */}
            <div style={{ width: "100%", height: "100%" }}>
                <GraphVisualization
                    nodes={displayNodes}
                    rels={displayRels}
                    layout="d3Force"
                    layoutOptions={{
                        enableCytoscape: true,
                    }}
                    nvlOptions={{
                        disableWebWorkers: true,
                        minZoom: 0.1,
                        maxZoom: 8,
                        initialZoom: 0.6,
                    }}
                    mouseEventCallbacks={{
                        onNodeClick: (node) => {
                            if (node) onSelectNode(node.id);
                            else onSelectNode("");
                        },
                        onRelationshipClick: (rel) => {
                            if (rel) onSelectEdge(rel.id);
                        },
                        onCanvasClick: () => {
                            onSelectNode("");
                        },
                    }}
                    sidepanel={{
                        isSidePanelOpen,
                        setIsSidePanelOpen,
                        onSidePanelResize: setSidePanelWidth,
                        sidePanelWidth,
                        children: <GraphVisualization.SingleSelectionSidePanelContents />,
                    }}
                />
            </div>
        </div>
    );
});
