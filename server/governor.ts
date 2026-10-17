// The viewer's reader for governor graphs: one log-replay snapshot (lib/snapshot.ts),
// normalized to the viewer's node and edge types. Bodies stay out of the snapshot; the
// live viewer's detail panel reads one at a time (governorNode).
import { Flywheel } from "../lib/flywheel";
import { parseEdge } from "../lib/model";
import { snapshot, type GraphSnapshot } from "../lib/snapshot";
import type { GraphEdge, GraphNode, NodeDetail, Snapshot } from "../shared/types";

export async function governorGraph(repo: string): Promise<GraphSnapshot | null> {
  const s = await snapshot(new Flywheel(repo));
  return s.root ? s : null;
}

export function toViewer(repo: string, s: GraphSnapshot): Snapshot {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const n of Object.values(s.nodes)) {
    if (!n.live) continue;
    const kind = n.kind ?? "other";
    nodes.push({
      id: n.id,
      title: n.title || n.slug,
      parentId: n.parents[0] ?? null,
      childCount: n.children.length,
      edgeCount: 0,
      lifecycle: "live",
      createdAt: n.at ?? undefined,
      tags: [
        { id: `graph:${kind}`, name: kind },
        ...(n.status ? [{ id: `status:${n.status}`, name: n.status }] : []),
        ...(n.folded ? [{ id: "governor:folded", name: "folded" }] : []),
      ],
    });
    for (const p of n.parents)
      if (s.nodes[p]?.live)
        edges.push({ id: `parent:${p}:${n.id}`, source: p, target: n.id, kind: "semantic", relation: "parent" });
  }
  for (const e of s.edges) {
    const rel = parseEdge(e.content).relation;
    edges.push({
      id: `edge:${e.id}`,
      source: e.source,
      target: e.target,
      kind: "semantic",
      // the hub anchors records by citations (claim → record); impacts read the same way reversed
      relation: "citation",
      content: rel === "impact" ? "impact" : "cites",
    });
  }
  const count = new Map<string, number>();
  for (const e of edges) count.set(e.source, (count.get(e.source) ?? 0) + 1);
  for (const n of nodes) n.edgeCount = count.get(n.id) ?? 0;
  return {
    source: "flywheel",
    repo,
    repositoryId: s.repositoryId ?? repo,
    head: s.head,
    stagedOperations: 0,
    nodes,
    edges,
    loadedAt: new Date().toISOString(),
  };
}

export function governorNode(s: GraphSnapshot, id: string): NodeDetail | null {
  const n = s.nodes[id];
  if (!n?.live) return null;
  const refs: Record<string, string> = {};
  for (const [, prefix, slug] of n.content.matchAll(CITATION)) {
    const kind = prefix === "rec" ? "record" : prefix;
    const target = Object.values(s.nodes).find((m) => m.live && m.slug === slug && m.kind === kind);
    if (target) refs[`${prefix}:${slug}`] = target.id;
  }
  return { id: n.id, slug: n.slug, title: n.title || n.slug, summary: n.summary, content: n.content, refs };
}
const CITATION = /\[(rec|state|plan):\s*([a-zA-Z0-9_-]+)\s*\]/g;
