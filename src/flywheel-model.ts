import type { GraphEdge, GraphNode } from "../shared/types";
import { collapseChains } from "./collapse-chains";

export type Point = { x: number; y: number };
export type Fold = { kind: "run" | "fan"; members: string[] };
export type OrbitComponent = {
  id: string;
  title: string;
  nodes: GraphNode[];
  roots: string[];
  center: Point;
  radius: number;
  rings: number[];
  orbit: number;
};

/** Structural topology alone defines local galaxies; citations stay cross-links. */
export function structuralEdges(edges: GraphEdge[]) {
  const containment = edges.some((e) => e.kind === "containment");
  const parents = edges.some((e) => e.relation === "parent");
  return edges.filter((e) =>
    containment
      ? e.kind === "containment"
      : parents
        ? e.relation === "parent"
        : e.relation !== "citation",
  );
}

/** Independent implementation of the live viewer's run and leaf-fan projections. */
export function projectFlywheel(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expanded = new Set<string>(),
  fold = true,
) {
  if (!fold)
    return {
      nodes,
      edges,
      groups: new Map<string, Fold>(),
      owner: new Map<string, string>(),
    };
  const candidates = collapseChains(nodes, edges);
  // Live default: three interior nodes, geometry floor based on 36-unit bodies/bands.
  const open = new Set(expanded);
  for (const [id, members] of candidates.groups)
    if (!fold || members.length < 3) open.add(id);
  const chains = collapseChains(nodes, edges, open);
  const groups = new Map<string, Fold>();
  for (const [id, members] of chains.groups)
    if (!open.has(id)) groups.set(id, { kind: "run", members });
  const incoming = new Map(chains.nodes.map((n) => [n.id, new Set<string>()]));
  const outgoing = new Map(chains.nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of structuralEdges(chains.edges)) {
    if (!incoming.has(e.target) || !outgoing.has(e.source)) continue;
    incoming.get(e.target)!.add(e.source);
    outgoing.get(e.source)!.add(e.target);
  }
  const owner = new Map(chains.owner);
  const added: GraphNode[] = [];
  const byId = new Map(chains.nodes.map((n) => [n.id, n]));
  const hidden = new Set<string>();
  if (fold)
    for (const parent of chains.nodes) {
      const members = [...outgoing.get(parent.id)!]
        .filter(
          (id) =>
            incoming.get(id)!.size === 1 &&
            outgoing.get(id)!.size === 0 &&
            !groups.has(id),
        )
        .sort();
      if (members.length < 6) continue;
      let id = `flywheel-fan:${JSON.stringify([parent.id, members])}`;
      while (byId.has(id)) id = `:${id}`;
      if (expanded.has(id)) continue;
      groups.set(id, { kind: "fan", members });
      for (const member of members) {
        hidden.add(member);
        owner.set(member, id);
      }
      const tags = new Map(
        members.flatMap((member) =>
          (byId.get(member)!.tags ?? []).map((tag) => [tag.id, tag] as const),
        ),
      );
      added.push({
        id,
        title: "Leaf fan",
        parentId: parent.id,
        childCount: 0,
        edgeCount: members.length,
        lifecycle: "live",
        tags: [...tags.values()],
      });
    }
  const seen = new Set<string>();
  const projectedEdges = chains.edges.flatMap((e) => {
    const source = owner.get(e.source) ?? e.source,
      target = owner.get(e.target) ?? e.target;
    if (source === target && (hidden.has(e.source) || hidden.has(e.target)))
      return [];
    const key = JSON.stringify([source, target, e.kind, e.relation]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...e, source, target }];
  });
  return {
    nodes: [
      ...chains.nodes
        .filter((n) => !hidden.has(n.id))
        .map((n) =>
          groups.get(n.id)?.kind === "run" ? { ...n, title: "Folded run" } : n,
        ),
      ...added,
    ],
    edges: projectedEdges,
    groups,
    owner,
  };
}

/** Generation rings within components, then non-overlapping component orbits. */
export function layoutFlywheel(nodes: GraphNode[], edges: GraphEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = structuralEdges(edges).filter(
    (e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target,
  );
  const neighbors = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  const incoming = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  const outgoing = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of links) {
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
    incoming.get(e.target)!.add(e.source);
    outgoing.get(e.source)!.add(e.target);
  }
  const positions = new Map<string, Point>();
  const components: OrbitComponent[] = [];
  const visited = new Set<string>();
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const ids = [node.id];
    visited.add(node.id);
    for (let i = 0; i < ids.length; i++)
      for (const next of neighbors.get(ids[i])!)
        if (!visited.has(next)) {
          visited.add(next);
          ids.push(next);
        }
    let roots = ids.filter((id) => !incoming.get(id)!.size);
    if (!roots.length) roots = [ids[0]];
    const depths = new Map(roots.map((id) => [id, 0]));
    const order = [...roots];
    for (let i = 0; i < order.length; i++)
      for (const next of outgoing.get(order[i])!)
        if (!depths.has(next)) {
          depths.set(next, depths.get(order[i])! + 1);
          order.push(next);
        }
    for (const id of ids)
      if (!depths.has(id)) {
        depths.set(id, 1);
        order.push(id);
      }
    // Longest-path generations for DAGs; the BFS fallback keeps cyclic fixtures finite.
    const indegree = new Map(ids.map((id) => [id, incoming.get(id)!.size]));
    const topo = ids.filter((id) => indegree.get(id) === 0);
    const longest = new Map(topo.map((id) => [id, 0]));
    for (let i = 0; i < topo.length; i++)
      for (const next of outgoing.get(topo[i])!) {
        longest.set(
          next,
          Math.max(longest.get(next) ?? 0, (longest.get(topo[i]) ?? 0) + 1),
        );
        indegree.set(next, indegree.get(next)! - 1);
        if (!indegree.get(next)) topo.push(next);
      }
    if (topo.length === ids.length)
      for (const [id, depth] of longest) depths.set(id, depth);
    // A stable spanning tree supplies angular order; merge edges remain visible.
    const children = new Map(ids.map((id) => [id, [] as string[]]));
    const parent = new Map<string, string>();
    for (const id of order) {
      const candidates = [...incoming.get(id)!].filter(
        (p) => depths.get(p)! < depths.get(id)!,
      );
      if (candidates.length) {
        candidates.sort(
          (a, b) => depths.get(b)! - depths.get(a)! || a.localeCompare(b),
        );
        parent.set(id, candidates[0]);
        children.get(candidates[0])!.push(id);
      }
    }
    const angularRoots = ids.filter((id) => !parent.has(id));
    const weights = new Map<string, number>();
    const sorted = [...ids].sort((a, b) => depths.get(b)! - depths.get(a)!);
    for (const id of sorted)
      weights.set(
        id,
        Math.max(
          1,
          children.get(id)!.reduce((sum, c) => sum + (weights.get(c) ?? 1), 0),
        ),
      );
    const angles = new Map<string, number>();
    const sectors = angularRoots.map((id) => ({ id, start: 0, end: 0 }));
    let cursor = -Math.PI / 2;
    const total = angularRoots.reduce((sum, id) => sum + weights.get(id)!, 0);
    for (const sector of sectors) {
      sector.start = cursor;
      cursor += (Math.PI * 2 * weights.get(sector.id)!) / total;
      sector.end = cursor;
    }
    for (let i = 0; i < sectors.length; i++) {
      const { id, start, end } = sectors[i];
      angles.set(id, (start + end) / 2);
      let a = start;
      const sum = children.get(id)!.reduce((s, c) => s + weights.get(c)!, 0);
      for (const child of children.get(id)!) {
        const b = a + ((end - start) * weights.get(child)!) / sum;
        sectors.push({ id: child, start: a, end: b });
        a = b;
      }
    }
    const layers = new Map<number, string[]>();
    for (const id of ids) {
      const d = depths.get(id)! + (roots.length > 1 ? 1 : 0);
      const layer = layers.get(d) ?? [];
      layer.push(id);
      layers.set(d, layer);
    }
    let radius = 0;
    const rings: number[] = [];
    for (const [depth, layer] of [...layers].sort((a, b) => a[0] - b[0])) {
      if (depth === 0 && layer.length === 1) {
        positions.set(layer[0], { x: 0, y: 0 });
        continue;
      }
      radius = Math.max(radius + 108, (layer.length * 100) / (2 * Math.PI));
      const ordered = layer.sort((a, b) => angles.get(a)! - angles.get(b)!);
      // Preserve angular order, gently spread each generation to avoid glyph collisions.
      const gap = 2 * Math.asin(Math.min(1, 48 / radius));
      // Least-squares projection onto minimum-gap constraints, including the seam.
      const blocks: { sum: number; count: number }[] = [];
      ordered.forEach((id, i) => {
        blocks.push({ sum: angles.get(id)! - i * gap, count: 1 });
        while (blocks.length > 1) {
          const a = blocks.at(-2)!,
            b = blocks.at(-1)!;
          if (a.sum / a.count <= b.sum / b.count) break;
          blocks.splice(-2, 2, {
            sum: a.sum + b.sum,
            count: a.count + b.count,
          });
        }
      });
      const adjusted: number[] = [];
      const lo = -Math.PI / 2 + gap / 2,
        hi = (3 * Math.PI) / 2 - gap / 2 - (ordered.length - 1) * gap;
      for (const block of blocks) {
        const base = Math.max(lo, Math.min(hi, block.sum / block.count));
        for (let j = 0; j < block.count; j++)
          adjusted.push(base + adjusted.length * gap);
      }
      ordered.forEach((id, i) =>
        positions.set(id, {
          x: Math.cos(adjusted[i]) * radius,
          y: Math.sin(adjusted[i]) * radius,
        }),
      );
      rings.push(radius);
    }
    components.push({
      id: roots[0],
      title: byId.get(roots[0])!.title,
      nodes: ids.map((id) => byId.get(id)!),
      roots,
      center: { x: 0, y: 0 },
      radius: Math.max(100, radius + 90),
      rings,
      orbit: 0,
    });
  }
  components.sort((a, b) => b.radius - a.radius || a.id.localeCompare(b.id));
  // Largest graph occupies the center. Smaller graphs pack into orbital tiers.
  const orbits: number[] = [];
  let i = 1,
    previousOuter = components[0]?.radius ?? 0;
  while (i < components.length) {
    const largest = components[i].radius;
    const orbit = previousOuter + largest + 160;
    let angle = -Math.PI / 2,
      used = 0;
    const tier: OrbitComponent[] = [];
    while (i < components.length) {
      const c = components[i];
      const span = 2 * Math.asin(Math.min(0.99, (c.radius + 60) / orbit));
      if (tier.length && used + span > Math.PI * 2) break;
      c.center = {
        x: Math.cos(angle + span / 2) * orbit,
        y: Math.sin(angle + span / 2) * orbit,
      };
      c.orbit = orbit;
      tier.push(c);
      used += span;
      angle += span;
      i++;
    }
    orbits.push(orbit);
    previousOuter = orbit + largest;
  }
  for (const c of components)
    for (const n of c.nodes) {
      const p = positions.get(n.id)!;
      positions.set(n.id, { x: p.x + c.center.x, y: p.y + c.center.y });
    }
  const extent = Math.max(
    160,
    ...components.map((c) => Math.hypot(c.center.x, c.center.y) + c.radius),
  );
  return { positions, components, orbits, extent };
}
