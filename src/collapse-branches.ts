import type { GraphNode, GraphEdge } from "../shared/types";

/** A display hierarchy only: sibling bundles and folded subtrees never edit source data. */
export function collapseBranches(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expanded = new Set<string>(),
  revealed = new Set<string>(),
) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map(nodes.map((n) => [n.id, [] as string[]]));
  const incoming = new Set<string>();
  const containment = edges.some((e) => e.kind === "containment");
  const parents = edges.some((e) => e.relation === "parent");
  const hierarchy = edges.filter((e) =>
    containment
      ? e.kind === "containment"
      : parents
        ? e.relation === "parent"
        : e.relation !== "citation",
  );
  for (const e of hierarchy)
    if (byId.has(e.source) && byId.has(e.target) && e.source !== e.target) {
      adjacency.get(e.source)!.push(e.target);
      incoming.add(e.target);
    }
  type Item = {
    id: string;
    children: Item[];
    members: string[];
    virtual: boolean;
  };
  const items = new Map(
    nodes.map((n) => [
      n.id,
      { id: n.id, children: [], members: [n.id], virtual: false } as Item,
    ]),
  );
  const roots: Item[] = [],
    order: Item[] = [],
    seen = new Set<string>();
  for (const n of [...nodes.filter((n) => !incoming.has(n.id)), ...nodes]) {
    if (seen.has(n.id)) continue;
    const root = items.get(n.id)!;
    roots.push(root);
    seen.add(n.id);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      order.push(item);
      for (const child of adjacency.get(item.id)!)
        if (!seen.has(child)) {
          seen.add(child);
          item.children.push(items.get(child)!);
          queue.push(items.get(child)!);
        }
    }
  }
  const fresh = (signature: string) => {
    let id = `branch-summary:${signature}`;
    while (byId.has(id)) id = `:${id}`;
    return id;
  };
  const bundle = (children: Item[]): Item[] => {
    if (children.length <= 5) return children;
    const size = Math.ceil(children.length / 5),
      result: Item[] = [];
    for (let i = 0; i < children.length; i += size) {
      const part = children.slice(i, i + size);
      result.push({
        id: fresh(`group:${JSON.stringify(part.map((c) => c.id))}`),
        virtual: true,
        members: part.flatMap((c) => c.members),
        children: bundle(part),
      });
    }
    return result;
  };
  for (const item of [...order].reverse()) {
    item.members = [item.id, ...item.children.flatMap((c) => c.members)];
    item.children = bundle(item.children);
  }
  const keys = new Map(
    order.map((item) => [item.id, fresh(`node:${JSON.stringify(item.id)}`)]),
  );
  const visible: GraphNode[] = [],
    displayEdges: GraphEdge[] = [],
    owner = new Map<string, string>();
  const groups = new Map<string, string[]>();
  const addSummary = (id: string, members: string[], title: string) => {
    const tags = new Map(
      members.flatMap((id) =>
        (byId.get(id)!.tags || []).map(
          (t) => [JSON.stringify([t.id, t.scope]), t] as const,
        ),
      ),
    );
    visible.push({
      id,
      title,
      parentId: null,
      childCount: 1,
      edgeCount: 0,
      lifecycle: "live",
      tags: [...tags.values()],
    });
  };
  const render = (item: Item, depth: number, parent?: string) => {
    const key = item.virtual ? item.id : keys.get(item.id)!;
    const folded =
      (item.virtual || depth >= 2) &&
      item.members.length > 1 &&
      !expanded.has(key) &&
      !item.members.some((id) => revealed.has(id));
    const id = folded ? key : item.id;
    if (parent)
      displayEdges.push({
        id: `display:${JSON.stringify([parent, id])}`,
        source: parent,
        target: id,
        kind: "containment",
      });
    if (folded) {
      groups.set(id, item.members);
      addSummary(
        id,
        item.members,
        `${item.virtual ? "Sibling branches" : byId.get(item.id)!.title} · Click to expand branch`,
      );
      for (const member of item.members) owner.set(member, id);
    } else {
      if (item.virtual) addSummary(id, item.members, "Branch group");
      else {
        visible.push(byId.get(id)!);
        owner.set(id, id);
      }
      for (const child of item.children)
        render(child, expanded.has(key) ? 2 : depth + 1, id);
    }
  };
  for (const root of bundle(roots)) render(root, 0);
  // Aggregate projected links by visible endpoints and kind. Tree edges above
  // express the display hierarchy; all other relationships remain traceable.
  const hierarchyIds = new Set(hierarchy.map((e) => e.id));
  const treePairs = new Set(
    displayEdges.map((e) => JSON.stringify([e.source, e.target])),
  );
  const links = new Set<string>();
  for (const e of edges) {
    const source = owner.get(e.source),
      target = owner.get(e.target);
    if (
      !source ||
      !target ||
      (source === target && (source !== e.source || target !== e.target))
    )
      continue;
    if (
      hierarchyIds.has(e.id) &&
      treePairs.has(JSON.stringify([source, target]))
    )
      continue;
    const key = JSON.stringify([source, target, e.kind, e.relation]);
    if (links.has(key)) continue;
    links.add(key);
    displayEdges.push({
      ...e,
      kind: "semantic",
      id: `projected:${key}`,
      source,
      target,
    });
  }
  return { nodes: visible, edges: displayEdges, groups, owner };
}
