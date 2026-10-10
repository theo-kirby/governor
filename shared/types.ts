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
  source?: "flywheel" | "hypergraph";
  warnings?: string[];
  repo: string;
  repositoryId: string;
  head: string | null;
  stagedOperations: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  loadedAt: string;
}
