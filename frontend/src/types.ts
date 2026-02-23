export type JobStatus = "queued" | "running" | "completed" | "failed";

export type QuestionGraphNodeType = "question" | "file" | "class" | "function" | "concept" | "evidence" | "code" | string;

export interface QuestionGraphNode {
    id: string;
    type: QuestionGraphNodeType;
    label: string;
    subtitle?: string;
    ref_id?: string;
    meta?: Record<string, unknown>;
}

export interface QuestionGraphEdge {
    id: string;
    source: string;
    target: string;
    label: string;
    meta?: Record<string, unknown>;
}

export interface QuestionGraph {
    nodes: QuestionGraphNode[];
    edges: QuestionGraphEdge[];
}

export interface QuestionGraphLayoutNode extends QuestionGraphNode {
    x: number;
    y: number;
}
