import type { GraphNode, GraphEdge } from "../shared/types";

import { compactRings } from "./compact-rings";

export const NODE_DIAMETER = 32;
export const CONTAINER_DIAMETER = 44;
const RING_GAP = 180;
const LABEL_SPACING = 140;

/** A radial containment forest; semantic-only graphs use their directed edges. */
export interface LayoutOptions {
  ringGap?: number;
  spacing?: number;
  adaptive?: boolean;
  compact?: boolean;
}
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {},
) {
  const adaptive = (options.adaptive ?? true) && nodes.length > 40;
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
        tree
          .get(id)!
          .reduce((sum, child) => sum + weights.get(child)!, adaptive ? 1 : 0),
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
    const childWeight = adaptive
      ? tree.get(item.id)!.reduce((sum, child) => sum + weights.get(child)!, 0)
      : weights.get(item.id)!;
    for (const child of tree.get(item.id)!) {
      const sweep = (item.sweep * weights.get(child)!) / childWeight;
      queue.push({ id: child, start: next, sweep, depth: item.depth + 1 });
      next += sweep;
    }
  }
  if (adaptive && options.compact !== false)
    return compactRings(
      queue.map((item) => item.id),
      tree,
      polar,
      spacing,
      ringGap,
    );
  if (adaptive) {
    const parent = new Map<string, string>();
    for (const [id, children] of tree)
      for (const child of children) parent.set(child, id);
    const original = new Map(
      [...polar].map(([id, point]) => [id, point.angle]),
    );
    const levels = new Map<number, string[]>();
    for (const [id, point] of polar) {
      const level = levels.get(point.depth) || [];
      level.push(id);
      levels.set(point.depth, level);
    }
    const radii = new Map<number, number>();
    let previous = 0;
    for (const [depth, level] of [...levels].sort((a, b) => a[0] - b[0])) {
      level.sort((a, b) => original.get(a)! - original.get(b)!);
      const capacity =
        level.length > 1
          ? spacing / (2 * Math.sin(Math.PI / level.length)) / 0.85
          : 0;
      const radius = depth === 0 ? 0 : Math.max(previous + ringGap, capacity);
      radii.set(depth, radius);
      previous = radius;
      if (!radius) continue;
      const gap =
        level.length > 1
          ? 2 * Math.asin(Math.min(1, spacing / (2 * radius)))
          : 0;
      // Preserve cyclic branch order while borrowing vacant angular space.
      // Isotonic regression finds the smallest squared adjustment to the
      // preferred angles subject to a minimum gap, including across the seam.
      const blocks: { sum: number; count: number }[] = [];
      level.forEach((id, i) => {
        const ancestor = parent.get(id);
        const shift = ancestor
          ? polar.get(ancestor)!.angle - original.get(ancestor)!
          : 0;
        blocks.push({
          sum: original.get(id)! + shift * 0.8 - i * gap,
          count: 1,
        });
        while (blocks.length > 1) {
          const a = blocks[blocks.length - 2],
            b = blocks[blocks.length - 1];
          if (a.sum / a.count <= b.sum / b.count) break;
          blocks.splice(-2, 2, {
            sum: a.sum + b.sum,
            count: a.count + b.count,
          });
        }
      });
      let index = 0;
      const lo = -Math.PI / 2 + gap / 2,
        hi = (3 * Math.PI) / 2 - gap / 2 - (level.length - 1) * gap;
      for (const block of blocks) {
        const base = Math.max(lo, Math.min(hi, block.sum / block.count));
        for (let i = 0; i < block.count; i++, index++)
          polar.get(level[index])!.angle = base + index * gap;
      }
    }
    return new Map(
      nodes.map((node) => {
        const p = polar.get(node.id)!,
          radius = radii.get(p.depth)!;
        return [
          node.id,
          { x: Math.cos(p.angle) * radius, y: Math.sin(p.angle) * radius },
        ] as const;
      }),
    );
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
