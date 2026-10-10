import type { GraphNode, GraphEdge } from "../shared/types";
import { layoutGraph, spanningForest, type LayoutOptions } from "./layout";

export interface Region {
  id: string;
  title: string;
  x: number;
  y: number;
  radius: number;
  members: string[];
  children: Region[];
  parent?: string;
  node?: GraphNode;
}
export interface Atlas {
  root: Region;
  regions: Map<string, Region>;
  edges: GraphEdge[];
}

/** Experimental spatial neighborhoods, not inferred semantic communities.
 * Hierarchy preorder keeps neighboring branches together. Component boundaries
 * are retained; oversized components are partitioned into bounded neighborhoods.
 * The fixed nested layout never changes as the camera or detail threshold moves.
 */
export function buildAtlas(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions & { neighborhoodSize?: number } = {},
): Atlas {
  const capacity = Math.max(
    8,
    Math.min(40, Math.round(options.neighborhoodSize || 24)),
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const { roots, tree } = spanningForest(nodes, edges);
  const regions = new Map<string, Region>();
  let serial = 0;
  const make = (
    members: string[],
    children: Region[],
    title: string,
  ): Region => {
    const region: Region = {
      id: `region:${serial++}`,
      members,
      children,
      title,
      x: 0,
      y: 0,
      radius: 1,
    };
    regions.set(region.id, region);
    return region;
  };
  const leaf = (ids: string[]) => {
    const localNodes = ids.map((id) => byId.get(id)!);
    const included = new Set(ids);
    const localEdges = edges.filter(
      (e) => included.has(e.source) && included.has(e.target),
    );
    const positions = layoutGraph(localNodes, localEdges, options);
    const extent = Math.max(
      1,
      ...[...positions.values()].map((p) => Math.hypot(p.x, p.y)),
    );
    // Keep small graphs exactly as before; limit only large-graph neighborhood extents.
    const scale = nodes.length <= 40 ? 1 : 480 / extent;
    const children = localNodes.map((node) => {
      const region = make([node.id], [], node.title);
      region.node = node;
      region.radius = node.childCount ? 22 : 16;
      const p = positions.get(node.id)!;
      region.x = p.x * scale;
      region.y = p.y * scale;
      return region;
    });
    // Normalizing a long chain must also reduce its node glyphs; retaining
    // fixed-size circles would overlap even though the source layout is valid.
    if (nodes.length > 40)
      for (const child of children) {
        const nearest = Math.min(
          Infinity,
          ...children
            .filter((other) => other !== child)
            .map((other) => Math.hypot(other.x - child.x, other.y - child.y)),
        );
        child.radius = Math.min(child.radius, nearest * 0.32);
      }
    const region = make(ids, children, localNodes[0]?.title || "Empty graph");
    region.radius = extent * scale + 100;
    return region;
  };
  const pack = (children: Region[], title: string): Region => {
    if (children.length === 1) return children[0];
    const region = make(
      children.flatMap((c) => c.members),
      children,
      title,
    );
    const largest = Math.max(1, ...children.map((c) => c.radius));
    // Unequal components must not reserve a largest-component-sized slot each.
    // Place smaller disks around the largest, then center the occupied bounds.
    if (largest > Math.min(...children.map((c) => c.radius)) * 1.8) {
      const placed: Region[] = [];
      for (const child of [...children].sort((a, b) => b.radius - a.radius)) {
        let best = { x: 0, y: 0, score: Infinity };
        if (!placed.length) best = { x: 0, y: 0, score: 0 };
        for (const anchor of placed)
          for (let i = 0; i < 72; i++) {
            const angle = -Math.PI / 2 + (i * Math.PI) / 36;
            const distance = anchor.radius + child.radius + 100;
            const x = anchor.x + Math.cos(angle) * distance;
            const y = anchor.y + Math.sin(angle) * distance;
            if (
              placed.some(
                (p) =>
                  Math.hypot(p.x - x, p.y - y) < p.radius + child.radius + 99,
              )
            )
              continue;
            const score = Math.hypot(x, y) + child.radius;
            // Near ties must not rotate the map between JS runtimes.
            if (score < best.score - 0.000001) best = { x, y, score };
          }
        child.x = best.x;
        child.y = best.y;
        placed.push(child);
      }
      const minX = Math.min(...children.map((c) => c.x - c.radius));
      const maxX = Math.max(...children.map((c) => c.x + c.radius));
      const minY = Math.min(...children.map((c) => c.y - c.radius));
      const maxY = Math.max(...children.map((c) => c.y + c.radius));
      for (const child of children) {
        child.x -= (minX + maxX) / 2;
        child.y -= (minY + maxY) / 2;
      }
      region.radius =
        Math.max(...children.map((c) => Math.hypot(c.x, c.y) + c.radius)) + 80;
      return region;
    }
    const orbit =
      children.length > 1
        ? (largest + 60) / Math.sin(Math.PI / children.length)
        : 0;
    children.forEach((child, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / children.length;
      child.x = Math.cos(angle) * orbit;
      child.y = Math.sin(angle) * orbit;
    });
    region.radius = orbit + largest + 80;
    return region;
  };
  const partition = (ids: string[]): Region => {
    if (ids.length <= capacity) return leaf(ids);
    const parts = Math.min(6, Math.ceil(ids.length / capacity));
    const size = Math.ceil(ids.length / parts);
    const index = new Map(ids.map((id, i) => [id, i]));
    let cuts: number[] = [];
    // Prefer actual branch boundaries over equal-sized slices. In a balanced
    // tree this preserves subtrees and avoids inventing crossing coarse links.
    for (const id of ids) {
      const branches = tree.get(id)!.filter((child) => index.has(child));
      if (branches.length < 2) continue;
      if (branches.length <= 6)
        cuts = branches.slice(1).map((child) => index.get(child)!);
      else {
        const starts = branches.slice(1).map((child) => index.get(child)!);
        for (let target = size; target < ids.length; target += size) {
          const nearest = starts.reduce((best, value) =>
            Math.abs(value - target) < Math.abs(best - target) ? value : best,
          );
          if (!cuts.includes(nearest)) cuts.push(nearest);
        }
      }
      break;
    }
    cuts.sort((a, b) => a - b);
    const boundaries = [0, ...cuts, ids.length];
    // Deep chains and strongly lopsided trees need bounded-depth spatial cuts.
    if (
      cuts.length &&
      boundaries
        .slice(1)
        .every((end, i) => end - boundaries[i] <= ids.length * 0.85)
    ) {
      return pack(
        boundaries
          .slice(1)
          .map((end, i) => partition(ids.slice(boundaries[i], end))),
        byId.get(ids[0])!.title,
      );
    }
    const children: Region[] = [];
    for (let i = 0; i < ids.length; i += size)
      children.push(partition(ids.slice(i, i + size)));
    return pack(children, byId.get(ids[0])!.title);
  };
  let root: Region;
  if (nodes.length <= 40) root = leaf(nodes.map((n) => n.id));
  else {
    let components = roots.map((id) => {
      const ids: string[] = [];
      const stack = [id];
      while (stack.length) {
        const current = stack.pop()!;
        ids.push(current);
        const children = tree.get(current)!;
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
      return partition(ids);
    });
    // Also bound the fanout for thousands of disconnected nodes.
    while (components.length > 6) {
      const next: Region[] = [];
      for (let i = 0; i < components.length; i += 6)
        next.push(
          pack(components.slice(i, i + 6), "Disconnected neighborhoods"),
        );
      components = next;
    }
    root = pack(components, "Whole graph");
  }
  const place = (region: Region, x: number, y: number) => {
    region.x += x;
    region.y += y;
    for (const child of region.children) {
      child.parent = region.id;
      place(child, region.x, region.y);
    }
  };
  place(root, 0, 0);
  return {
    root,
    regions,
    edges: edges.filter((e) => byId.has(e.source) && byId.has(e.target)),
  };
}

export interface AtlasLink {
  source: string;
  target: string;
  kind: "structure" | "cross";
  count: number;
}
/** A frontier partitions all original nodes exactly once, even off screen. */
export function atlasFrontier(atlas: Atlas, zoom: number, detail = 180) {
  const items: Region[] = [];
  const visit = (region: Region) => {
    if (region.node || (region !== atlas.root && region.radius * zoom < detail))
      items.push(region);
    else for (const child of region.children) visit(child);
  };
  visit(atlas.root);
  const owner = new Map<string, string>();
  for (const item of items)
    for (const id of item.members) owner.set(id, item.id);
  const links = new Map<string, AtlasLink>();
  const internal = new Map<string, number>();
  for (const edge of atlas.edges) {
    const source = owner.get(edge.source)!;
    const target = owner.get(edge.target)!;
    if (source === target && !atlas.regions.get(source)!.node) {
      internal.set(source, (internal.get(source) || 0) + 1);
      continue;
    }
    const kind =
      edge.kind === "containment" || edge.relation === "parent"
        ? "structure"
        : "cross";
    const key = JSON.stringify([source, target, kind]);
    const link = links.get(key);
    if (link) link.count++;
    else links.set(key, { source, target, kind, count: 1 });
  }
  return { items, links: [...links.values()], internal, owner };
}
