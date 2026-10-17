export interface NodeTag {
  id: string;
  name: string;
  scope?: string;
}
export interface GraphNode {
  id: string;
  title: string;
  parentId: string | null;
  childCount: number;
  edgeCount: number;
  lifecycle: string;
  tags?: NodeTag[];
  /** ISO-8601 creation time when the source records one (the hub layout's age axis). */
  createdAt?: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "containment" | "semantic";
  relation?: "parent" | "citation";
  scope?: string;
  content?: string | null;
}
export interface Snapshot {
  source?: "flywheel";
  warnings?: string[];
  repo: string;
  repositoryId: string;
  head: string | null;
  stagedOperations: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  loadedAt: string;
}
/** One node's full text, read on demand by the live viewer's detail panel. */
export interface NodeDetail {
  id: string;
  slug?: string;
  title: string;
  summary?: string;
  /** Markdown body. */
  content: string;
  /** Node ids of the body's `[rec|state|plan: slug]` citations, keyed "rec:slug". */
  refs?: Record<string, string>;
}
