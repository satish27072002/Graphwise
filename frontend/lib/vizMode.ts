/**
 * Detects the appropriate visualization mode based on the user's question
 * and the retrieval method used by the backend.
 *
 * Modes:
 *   "impact"     — radial burst layout with red center glow
 *   "dependency" — top-to-bottom tree layout
 *   "flow"       — left-to-right dagre layout (default)
 */

export type VisualizationMode = "flow" | "impact" | "dependency";

const IMPACT_PATTERN = /\b(break|breaks|broken|impact|affects|affect|what calls|callers? of|change|modify|modif|remove|delet|if i (change|remov|delet|modif))\b/i;

const DEPENDENCY_PATTERN = /\b(depends? on|dependency|dependencies|what does .{1,40} (need|use|import|depend)|what imports|imports of|uses|used by|list (all )?(dependencies|imports|callers?))\b/i;

/**
 * Returns the visualization mode for a given question and retrieval method.
 * Call this after receiving a query response.
 */
export function detectVisualizationMode(
  question: string,
  retrievalMethod: string,
): VisualizationMode {
  if (IMPACT_PATTERN.test(question)) return "impact";
  if (DEPENDENCY_PATTERN.test(question) || retrievalMethod.includes("cypher")) return "dependency";
  return "flow";
}

/** Human-readable label shown in the mode indicator pill */
export const VIZ_MODE_LABELS: Record<VisualizationMode, string> = {
  flow: "FLOW VIEW",
  impact: "IMPACT VIEW",
  dependency: "DEPENDENCY VIEW",
};

/** Accent color for each mode pill */
export const VIZ_MODE_COLORS: Record<VisualizationMode, string> = {
  flow: "var(--accent-primary)",
  impact: "#ef4444",
  dependency: "#14b8a6",
};
