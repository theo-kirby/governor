import type { GraphNode, GraphEdge } from "../shared/types";

/** Collapse only unbranched interiors. Citations are rerouted, never used as parents. */
export function collapseChains(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expanded = new Set<string>(),
) {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  const outgoing = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  const containment = edges.some((e) => e.kind === "containment");
  const parents = edges.some((e) => e.relation === "parent");
  const hierarchy = edges.filter((e) =>
    containment
      ? e.kind === "containment"
      : parents
        ? e.relation === "parent"
        : e.relation !== "citation",
  );
  for (const e of hierarchy) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    outgoing.get(e.source)!.add(e.target);
    incoming.get(e.target)!.add(e.source);
  }
  const linear = (id: string) =>
    incoming.get(id)!.size === 1 && outgoing.get(id)!.size === 1;
  const groups = new Map<string, string[]>();
  for (const start of nodes.filter((n) => !linear(n.id))) {
    for (const next of outgoing.get(start.id)!) {
      const interior: string[] = [],
        seen = new Set([start.id]);
      let current = next;
      while (linear(current) && !seen.has(current)) {
        seen.add(current);
        interior.push(current);
        current = [...outgoing.get(current)!][0];
      }
      // Leave loops intact, and avoid replacing one node with one marker.
      if (seen.has(current) || interior.length < 2) continue;
      let key = `chain:${JSON.stringify(interior)}`;
      while (ids.has(key)) key = `:${key}`;
      groups.set(key, interior);
    }
  }
  const owner = new Map<string, string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const summaries: GraphNode[] = [];
  for (const [id, members] of groups) {
    if (expanded.has(id)) continue;
    for (const member of members) owner.set(member, id);
    const tags = new Map(
      members.flatMap((member) =>
        (byId.get(member)!.tags || []).map(
          (tag) => [JSON.stringify([tag.id, tag.scope]), tag] as const,
        ),
      ),
    );
    summaries.push({
      id,
      title: `${members.length} nodes in chain · Click to expand`,
      parentId: null,
      childCount: 1,
      edgeCount: 0,
      lifecycle: "live",
      tags: [...tags.values()],
    });
  }
  const projected = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .flatMap((e) => {
      const source = owner.get(e.source) || e.source,
        target = owner.get(e.target) || e.target;
      // Internal relationships reappear when the chain is expanded.
      return source === target && owner.has(e.source)
        ? []
        : [{ ...e, source, target }];
    });
  return {
    nodes: [...nodes.filter((n) => !owner.has(n.id)), ...summaries],
    edges: projected,
    groups,
    owner,
  };
}
