import type { GraphNode, GraphEdge } from "./types";

/** Public shape for private report snapshots: topology and titles only. */
export interface ReportGraph {
  schemaVersion: 1;
  repositoryId: string;
  head: string | null;
  loadedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export function parseReportGraph(raw: unknown): ReportGraph {
  const fail = (): never => { throw new Error("Invalid report graph"); };
  const obj = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : fail();
  const str = (x: unknown, max = 256): string => typeof x === "string" && x.length <= max ? x : fail();
  const count = (x: unknown): number => Number.isSafeInteger(x) && (x as number) >= 0 ? x as number : fail();
  const v = obj(raw);
  if (v.schemaVersion !== 1 || !Array.isArray(v.nodes) || !Array.isArray(v.edges) || v.nodes.length > 5000 || v.edges.length > 20000) fail();
  const head = v.head === null ? null : str(v.head);
  if (head !== null && !/^sha256:[a-f0-9]{64}$/.test(head)) fail();
  const loadedAt = str(v.loadedAt);
  if (!Number.isFinite(Date.parse(loadedAt))) fail();
  const metadata = (n: Record<string, unknown>): Partial<GraphNode> => {
    const result: Partial<GraphNode> = {};
    if (n.createdAt !== undefined) {
      const at = str(n.createdAt);
      if (!Number.isFinite(Date.parse(at))) fail();
      result.createdAt = at;
    }
    if (n.tags !== undefined) {
      if (!Array.isArray(n.tags) || n.tags.length > 64) fail();
      const allowed = /^(?:graph:(?:root|state|record|plan|other)|status:(?:open|working|broken|blocked|superseded)|governor:folded)$/;
      result.tags = (n.tags as unknown[]).map(obj).filter(t => typeof t.id === "string" && allowed.test(t.id)).map(t => ({id: str(t.id), name: str(t.name)}));
    }
    return result;
  };
  const nodes: GraphNode[] = (v.nodes as unknown[]).map(raw => {
    const n = obj(raw);
    return {id: str(n.id), title: str(n.title, 2000), parentId: n.parentId === null ? null : str(n.parentId), childCount: count(n.childCount), edgeCount: count(n.edgeCount), lifecycle: "live", ...metadata(n)};
  });
  const ids = new Set(nodes.map(n => n.id));
  if (ids.size !== nodes.length || nodes.some(n => !n.id || (n.parentId !== null && !ids.has(n.parentId)))) fail();
  const edges: GraphEdge[] = (v.edges as unknown[]).map(raw => {
    const e = obj(raw);
    if (e.kind !== "containment" && e.kind !== "semantic") fail();
    const source = str(e.source), target = str(e.target);
    if (!ids.has(source) || !ids.has(target)) fail();
    if (e.relation !== undefined && e.relation !== "parent" && e.relation !== "citation") fail();
    return {id: str(e.id), source, target, kind: e.kind as GraphEdge["kind"], ...(e.relation ? {relation: e.relation as "parent" | "citation"} : {})};
  });
  if (new Set(edges.map(e => e.id)).size !== edges.length) fail();
  return {schemaVersion: 1, repositoryId: str(v.repositoryId), head, loadedAt, nodes, edges};
}
