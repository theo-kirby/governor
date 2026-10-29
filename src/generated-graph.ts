import type { GraphNode, GraphEdge } from "../shared/types";
import type { HubSettings } from "./hub-settings";

export function generateGraph(settings: Pick<HubSettings, "graphSource" | "graphSeed" | "graphStates" | "graphRecords" | "graphDepth" | "graphBranches" | "graphCitations">) {
  let seed = settings.graphSeed >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const procedural = settings.graphSource === "procedural";
  const stateCount = procedural ? settings.graphStates : 20 + Math.floor(random() * 100);
  const recordCount = procedural ? settings.graphRecords : 50 + Math.floor(random() * 350);
  const depth = procedural ? settings.graphDepth : 1 + Math.floor(random() * 4);
  const branches = procedural ? settings.graphBranches : 2 + Math.floor(random() * 10);
  const citations = procedural ? settings.graphCitations : 1 + Math.floor(random() * 4);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const add = (id: string, kind: string, parentId: string | null, level: number) => {
    const status = ["working", "open", "broken", "blocked", "done"][Math.floor(random() * 5)];
    nodes.push({ id, title: kind === "root" ? "Generated graph" : `${kind === "state" ? "State" : "Record"} ${id.split("-")[1]}`, parentId,
      childCount: 0, edgeCount: 0, lifecycle: "live",
      tags: [{id: `graph:${kind}`, name: kind}, ...(kind === "state" ? [{id: `status:${status}`, name: status}] : [])],
      createdAt: new Date(Date.UTC(2026, 0, 1) + nodes.length * 3600000).toISOString() });
    if (parentId) edges.push({id: `parent:${id}`, source: parentId, target: id, kind: "containment", relation: "parent"});
    return {id, level, children: 0};
  };
  const parents = [add("root", "root", null, 0)];
  for (let i = 0; i < stateCount; i++) {
    const eligible = parents.filter(p => p.level < depth && p.children < branches);
    // Branch count is a target: overflow goes on the last level to preserve exact counts.
    const candidates = eligible.length ? eligible : parents.filter(p => p.level === depth - 1);
    const parent = procedural ? candidates[0] : candidates[Math.floor(random() * candidates.length)];
    parent.children++;
    parents.push(add(`state-${i + 1}`, "state", parent.id, parent.level + 1));
  }
  for (let i = 0; i < recordCount; i++) {
    const record = add(`record-${i + 1}`, "record", null, 0);
    const targets = new Set<number>();
    while (targets.size < Math.min(citations, stateCount)) targets.add(1 + Math.floor(random() * stateCount));
    for (const target of targets) edges.push({id: `citation:${i}:${target}`, source: parents[target].id, target: record.id, kind: "semantic", relation: "citation"});
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const edge of edges) {
    byId.get(edge.source)!.edgeCount++;
    byId.get(edge.target)!.edgeCount++;
    if (edge.kind === "containment") byId.get(edge.source)!.childCount++;
  }
  return {nodes, edges};
}
