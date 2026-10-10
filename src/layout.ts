import type { GraphNode, GraphEdge } from "../shared/types";

export const NODE_DIAMETER = 32;
export const CONTAINER_DIAMETER = 44;
const RING_GAP = 180;
const LABEL_SPACING = 140;

/** A radial containment forest; semantic-only graphs use their directed edges. */
export interface LayoutOptions {
  ringGap?: number;
  spacing?: number;
}
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {},
) {
  const ringGap = options.ringGap ?? RING_GAP;
  const spacing = options.spacing ?? LABEL_SPACING;
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const incoming = new Set<string>();
  const containment = edges.filter((edge) => edge.kind === "containment");
  const parents = edges.filter((edge) => edge.relation === "parent");
  const hierarchy = containment.length
    ? containment
    : parents.length
      ? parents
      : edges.filter((edge) => edge.relation !== "citation");
  for (const edge of hierarchy) {
    if (
      !ids.has(edge.source) ||
      !ids.has(edge.target) ||
      edge.source === edge.target
    )
      continue;
    children.get(edge.source)!.push(edge.target);
    incoming.add(edge.target);
  }
  // Build a spanning forest so cycles and multiple parents never duplicate nodes.
  const roots: string[] = [];
  const visited = new Set<string>();
  const tree = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const order: string[] = [];
  for (const node of [
    ...nodes.filter((node) => !incoming.has(node.id)),
    ...nodes,
  ]) {
    if (visited.has(node.id)) continue;
    roots.push(node.id);
    visited.add(node.id);
    const queue = [node.id];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      order.push(id);
      for (const child of children.get(id)!) {
        if (visited.has(child)) continue;
        visited.add(child);
        tree.get(id)!.push(child);
        queue.push(child);
      }
    }
  }
  // Reserve one contiguous sector per subtree, shared across all its levels.
  // Re-spacing each ring independently would pull descendants across branches.
  const weights = new Map<string, number>();
  for (const id of [...order].reverse()) {
    weights.set(
      id,
      Math.max(
        1,
        tree.get(id)!.reduce((sum, child) => sum + weights.get(child)!, 0),
      ),
    );
  }
  const polar = new Map<string, { angle: number; depth: number }>();
  const total = roots.reduce((sum, root) => sum + weights.get(root)!, 0);
  let start = -Math.PI / 2;
  const queue: { id: string; start: number; sweep: number; depth: number }[] =
    [];
  for (const id of roots) {
    const sweep = (2 * Math.PI * weights.get(id)!) / total;
    queue.push({ id, start, sweep, depth: roots.length === 1 ? 0 : 1 });
    start += sweep;
  }
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    polar.set(item.id, {
      angle: item.start + item.sweep / 2,
      depth: item.depth,
    });
    let next = item.start;
    for (const child of tree.get(item.id)!) {
      const sweep = (item.sweep * weights.get(child)!) / weights.get(item.id)!;
      queue.push({ id: child, start: next, sweep, depth: item.depth + 1 });
      next += sweep;
    }
  }
  const rings = new Map<number, { angle: number; depth: number }[]>();
  for (const point of polar.values()) {
    const ring = rings.get(point.depth) || [];
    ring.push(point);
    rings.set(point.depth, ring);
  }
  // Keep concentric, regularly spaced levels without rotating branches apart.
  // Sparse levels intentionally retain gaps where other branches have ended.
  let radialStep = ringGap;
  for (const [depth, ring] of rings) {
    if (depth === 0 || ring.length < 2) continue;
    ring.sort((a, b) => a.angle - b.angle);
    for (let index = 0; index < ring.length; index++) {
      const next =
        index + 1 < ring.length
          ? ring[index + 1].angle
          : ring[0].angle + 2 * Math.PI;
      const gap = next - ring[index].angle;
      radialStep = Math.max(
        radialStep,
        spacing / (2 * Math.sin(gap / 2) * depth),
      );
    }
  }
  return new Map(
    nodes.map((node) => {
      const { angle, depth } = polar.get(node.id)!;
      const radius = depth * radialStep;
      return [
        node.id,
        { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
      ] as const;
    }),
  );
}
