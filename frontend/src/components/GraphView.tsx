import { memo, useCallback, useEffect, useRef, useState } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { QuestionGraph, QuestionGraphEdge, QuestionGraphNode } from "../types";

// ──────────────────────────────────────────────────────────
// Premium Neo4j-inspired color palette
// ──────────────────────────────────────────────────────────
const PALETTE = {
    question: { fill: "#f59e0b", glow: "rgba(245,158,11,0.35)", ring: "#fbbf24" },
    entity:   { fill: "#06b6d4", glow: "rgba(6,182,212,0.30)",  ring: "#22d3ee" },
    code:     { fill: "#10b981", glow: "rgba(16,185,129,0.30)", ring: "#34d399" },
    file:     { fill: "#10b981", glow: "rgba(16,185,129,0.30)", ring: "#34d399" },
    class:    { fill: "#10b981", glow: "rgba(16,185,129,0.30)", ring: "#34d399" },
    function: { fill: "#10b981", glow: "rgba(16,185,129,0.30)", ring: "#34d399" },
    concept:  { fill: "#0e7490", glow: "rgba(14,116,144,0.35)", ring: "#06b6d4" },
    evidence: { fill: "#8b5cf6", glow: "rgba(139,92,246,0.30)", ring: "#a78bfa" },
    default:  { fill: "#64748b", glow: "rgba(100,116,139,0.20)", ring: "#94a3b8" },
} as const;

type PaletteKey = keyof typeof PALETTE;

function getNodePalette(kind: string): (typeof PALETTE)[PaletteKey] {
    if (kind in PALETTE) return PALETTE[kind as PaletteKey];
    return PALETTE.default;
}

const EDGE_COLOR = "rgba(148,163,184,0.35)";
const EDGE_HIGHLIGHT = "rgba(251,113,133,0.8)";
const LABEL_COLOR = "#e2e8f0";
const SELECTED_RING = "#f43f5e";

// ──────────────────────────────────────────────────────────
// Custom node canvas renderer
// ──────────────────────────────────────────────────────────
function drawNode(
    node: { x?: number; y?: number; val?: number; label?: string; kind?: string },
    ctx: CanvasRenderingContext2D,
    globalScale: number,
    isSelected: boolean,
) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const radius = node.val ?? 8;
    const palette = getNodePalette(node.kind ?? "default");

    // Glow
    ctx.save();
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = isSelected ? 24 : 12;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = palette.fill;
    ctx.fill();
    ctx.restore();

    // Gradient fill
    const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    gradient.addColorStop(0, "rgba(255,255,255,0.25)");
    gradient.addColorStop(1, "rgba(0,0,0,0.0)");
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Selection ring
    if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = SELECTED_RING;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, radius + 6, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(244,63,94,0.3)";
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
    }

    // Label
    const label = node.label ?? "";
    const fontSize = Math.max(10, 12 / globalScale);
    if (globalScale > 0.8 || radius > 12) {
        ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = LABEL_COLOR;
        const maxWidth = 120 / globalScale;
        const displayLabel = label.length > 22 ? label.substring(0, 19) + "…" : label;
        ctx.fillText(displayLabel, x, y + radius + 4 / globalScale, maxWidth);
    }
}

// ──────────────────────────────────────────────────────────
// Extended types for force-graph
// ──────────────────────────────────────────────────────────
type ExtendedNode = QuestionGraphNode & {
    x?: number;
    y?: number;
    val?: number;
    color?: string;
    kind?: string;
};

type ExtendedEdge = QuestionGraphEdge & {
    source: string | ExtendedNode;
    target: string | ExtendedNode;
    color?: string;
};

// ──────────────────────────────────────────────────────────
// Question Graph View (interactive)
// ──────────────────────────────────────────────────────────
interface QuestionGraphViewProps {
    graph: QuestionGraph;
    selectedNodeId: string | null;
    selectedEdgeId: string | null;
    onSelectNode: (nodeId: string) => void;
    onSelectEdge: (edgeId: string) => void;
}

export const InteractiveQuestionGraph = memo(function InteractiveQuestionGraph({
    graph,
    selectedNodeId,
    selectedEdgeId,
    onSelectNode,
    onSelectEdge,
}: QuestionGraphViewProps) {
    const fgRef = useRef<ForceGraphMethods>();
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const { clientWidth, clientHeight } = containerRef.current;
        setDimensions({ width: clientWidth, height: Math.max(clientHeight, 500) });

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setDimensions({
                    width: entry.contentRect.width,
                    height: Math.max(entry.contentRect.height, 500),
                });
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    const graphData = {
        nodes: graph.nodes.map((node) => ({
            ...node,
            val: node.type === "question" ? 22 : node.type === "entity" || node.type === "class" ? 16 : 12,
            kind: node.type,
        })),
        edges: graph.edges.map((edge) => ({
            ...edge,
            color: edge.id === selectedEdgeId ? EDGE_HIGHLIGHT : EDGE_COLOR,
        })),
    };

    const handleNodeClick = useCallback(
        (node: ExtendedNode) => {
            onSelectNode(node.id);
            if (fgRef.current && node.x && node.y) {
                fgRef.current.centerAt(node.x, node.y, 800);
                fgRef.current.zoom(2.5, 800);
            }
        },
        [onSelectNode]
    );

    const handleLinkClick = useCallback(
        (link: ExtendedEdge) => {
            onSelectEdge(link.id);
        },
        [onSelectEdge]
    );

    const legendKinds = ["question", "file/class/function", "concept", "evidence"] as const;
    const legendColors = {
        "question": PALETTE.question.fill,
        "file/class/function": PALETTE.code.fill,
        "concept": PALETTE.concept.fill,
        "evidence": PALETTE.evidence.fill,
    } as const;
    const legendGlows = {
        "question": PALETTE.question.glow,
        "file/class/function": PALETTE.code.glow,
        "concept": PALETTE.concept.glow,
        "evidence": PALETTE.evidence.glow,
    } as const;

    return (
        <div
            ref={containerRef}
            className="w-full h-full min-h-[500px] rounded-2xl overflow-hidden relative shadow-2xl"
            style={{
                background: "linear-gradient(135deg, #0f172a 0%, #020617 50%, #0c0a20 100%)",
                border: "1px solid rgba(148,163,184,0.12)",
            }}
        >
            {/* Legend */}
            <div className="absolute top-4 left-4 z-10 flex gap-4 text-xs font-semibold rounded-xl border backdrop-blur-md"
                style={{
                    background: "rgba(15,23,42,0.85)",
                    borderColor: "rgba(148,163,184,0.15)",
                    padding: "10px 16px",
                }}
            >
                {legendKinds.map((kind) => (
                    <div key={kind} className="flex items-center gap-2 capitalize">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{
                                backgroundColor: legendColors[kind],
                                boxShadow: `0 0 6px ${legendGlows[kind]}`,
                            }}
                        />
                        {kind}
                    </div>
                ))}
            </div>

            {/* Interaction hint */}
            <div
                className="absolute bottom-4 left-4 z-10 text-xs font-medium rounded-lg backdrop-blur-md"
                style={{
                    background: "rgba(15,23,42,0.8)",
                    border: "1px solid rgba(148,163,184,0.12)",
                    color: "#94a3b8",
                    padding: "6px 12px",
                }}
            >
                Scroll to zoom · Drag nodes to reposition · Click to inspect
            </div>

            <ForceGraph2D
                ref={fgRef}
                width={dimensions.width}
                height={dimensions.height}
                graphData={{ nodes: graphData.nodes, links: graphData.edges }}
                nodeLabel={() => ""}
                nodeRelSize={6}
                linkDirectionalArrowLength={4}
                linkDirectionalArrowRelPos={1}
                linkColor={(link) => (link as ExtendedEdge).color || EDGE_COLOR}
                linkWidth={(link) => (link as ExtendedEdge).id === selectedEdgeId ? 2.5 : 1}
                linkCanvasObjectMode={() => "after"}
                linkCanvasObject={(link, ctx, globalScale) => {
                    if (globalScale < 0.5) return;
                    const edge = link as ExtendedEdge;
                    const label = edge.label;
                    if (!label) return;
                    const src = edge.source as ExtendedNode;
                    const tgt = edge.target as ExtendedNode;
                    if (!src.x || !src.y || !tgt.x || !tgt.y) return;
                    const midX = (src.x + tgt.x) / 2;
                    const midY = (src.y + tgt.y) / 2;
                    const fontSize = Math.max(9, 9 / globalScale);
                    ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle = "rgba(203,213,225,0.65)";
                    ctx.fillText(label, midX, midY);
                }}
                onNodeClick={(node) => handleNodeClick(node as ExtendedNode)}
                onLinkClick={(link) => handleLinkClick(link as ExtendedEdge)}
                enableNodeDrag={true}
                enableZoomInteraction={true}
                d3VelocityDecay={0.3}
                d3AlphaDecay={0.02}
                nodeCanvasObject={(node, ctx, globalScale) => {
                    drawNode(
                        { ...node as ExtendedNode, kind: (node as ExtendedNode).kind ?? (node as ExtendedNode).type },
                        ctx,
                        globalScale,
                        node.id === selectedNodeId,
                    );
                }}
                warmupTicks={80}
                cooldownTicks={0}
                backgroundColor="rgba(0,0,0,0)"
            />
        </div>
    );
});
