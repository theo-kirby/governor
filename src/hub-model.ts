import type { GraphEdge, GraphNode } from "../shared/types";
import type { Point } from "./flywheel-model";

/**
 * The hub layout: one graph drawn as a wheel.
 *
 * - the hub (the state root) sits at the centre;
 * - state nodes sit on rings by depth in the state tree, each subtree owning an angular
 *   sector sized by its claims and the evidence behind them (the spokes);
 * - record nodes fill the outer band (the rim), each placed at the angle of the state
 *   claims that cite it, newest nearest the claims and older history further out.
 *
 * Placement reads only parent links and state→record citations. Records nobody cites
 * borrow the angle of their causal neighbours.
 */
export type Kind = "state" | "record" | "plan" | "other";
export type HubRing = { radius: number; kind: "state" | "record" };
export type HubSector = {
  id: string;
  title: string;
  start: number;
  end: number;
};
export type HubScene = {
  hub: string | null;
  positions: Map<string, Point>;
  kind: Map<string, Kind>;
  depth: Map<string, number>;
  /** Record id → the state ids whose citations place it (empty when borrowed). */
  anchors: Map<string, string[]>;
  rings: HubRing[];
  sectors: HubSector[];
  bandStart: number;
  extent: number;
  hidden: Set<string>;
};

export const NODE_RADIUS = 36;
const STATE_RING = 300;
const SPACING = NODE_RADIUS * 2.6;
const RECORD_RING = NODE_RADIUS * 2.5;
const RECORD_FILL = 0.8;
const TAU = Math.PI * 2;

export function kindOf(node: GraphNode): Kind {
  for (const tag of node.tags ?? []) {
    const name = tag.id.startsWith("graph:")
      ? tag.id.slice(6)
      : tag.name.startsWith("kind:")
        ? tag.name.slice(5)
        : null;
    if (name === "state" || name === "record" || name === "plan") return name;
  }
  return "other";
}

const norm = (a: number) => ((a % TAU) + TAU) % TAU;

function circularMean(angles: number[]): number | null {
  if (!angles.length) return null;
  let x = 0,
    y = 0;
  for (const a of angles) {
    x += Math.cos(a);
    y += Math.sin(a);
  }
  if (Math.hypot(x, y) < 1e-9) return angles[0];
  return norm(Math.atan2(y, x));
}

/**
 * Spread angles on a circle so neighbours sit at least `gap` apart while keeping their
 * order. Works on the sorted list; the wrap-around pair is pushed too.
 */
export function relaxAngles(angles: number[], gap: number): number[] {
  const n = angles.length;
  if (n < 2) return angles.map(norm);
  const g = Math.min(gap, (TAU / n) * 0.999);
  const order = angles.map((a, i) => ({ a: norm(a), i })).sort((p, q) => p.a - q.a);
  const out = order.map((o) => o.a);
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      let d = out[j] - out[k];
      if (j === 0) d += TAU;
      if (d < g - 1e-9) {
        const push = (g - d) / 2;
        out[k] -= push;
        out[j] += push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const result = new Array<number>(n);
  order.forEach((o, k) => (result[o.i] = norm(out[k])));
  return result;
}

export function layoutHub(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: { includePlan?: boolean } = {},
): HubScene {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kind = new Map(nodes.map((n) => [n.id, kindOf(n)]));
  const hidden = new Set<string>();
  for (const n of nodes)
    if (kind.get(n.id) === "plan" && !options.includePlan) hidden.add(n.id);
    else if (kind.get(n.id) === "other") hidden.add(n.id);

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const citedBy = new Map<string, string[]>(); // record → citing state nodes
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target)
      continue;
    if (e.relation === "parent" || e.kind === "containment") {
      (parents.get(e.target) ?? parents.set(e.target, []).get(e.target)!).push(e.source);
      (children.get(e.source) ?? children.set(e.source, []).get(e.source)!).push(e.target);
    } else if (
      e.relation === "citation" &&
      kind.get(e.source) === "state" &&
      kind.get(e.target) === "record"
    )
      (citedBy.get(e.target) ?? citedBy.set(e.target, []).get(e.target)!).push(e.source);
  }

  // ---- the state tree (first parent wins; others stay drawn as edges)
  const state = nodes.filter((n) => kind.get(n.id) === "state");
  const record = nodes.filter((n) => kind.get(n.id) === "record");
  const stateRoots = state.filter(
    (n) => !(parents.get(n.id) ?? []).some((p) => kind.get(p) === "state"),
  );
  const hub = stateRoots[0]?.id ?? null;
  // the record root is the record graph's own anchor; the hub stands in for it
  for (const n of record)
    if (!(parents.get(n.id) ?? []).some((p) => kind.get(p) === "record")) hidden.add(n.id);

  const depth = new Map<string, number>();
  const treeChildren = new Map<string, string[]>();
  if (hub) {
    depth.set(hub, 0);
    const queue = [hub];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const c of children.get(id) ?? []) {
        if (kind.get(c) !== "state" || depth.has(c)) continue;
        depth.set(c, depth.get(id)! + 1);
        (treeChildren.get(id) ?? treeChildren.set(id, []).get(id)!).push(c);
        queue.push(c);
      }
    }
    // further state roots (a second tree) hang off the hub
    for (const r of stateRoots.slice(1)) {
      depth.set(r.id, 1);
      (treeChildren.get(hub) ?? treeChildren.set(hub, []).get(hub)!).push(r.id);
    }
  }

  const directAnchors = new Map<string, number>();
  for (const cites of citedBy.values())
    for (const s of new Set(cites)) directAnchors.set(s, (directAnchors.get(s) ?? 0) + 1);
  const weight = new Map<string, number>();
  const weigh = (id: string): number => {
    let w = 1 + 0.15 * (directAnchors.get(id) ?? 0);
    for (const c of treeChildren.get(id) ?? []) w += weigh(c);
    weight.set(id, w);
    return w;
  };
  const span = new Map<string, [number, number]>();
  const sectors: HubSector[] = [];
  if (hub) {
    weigh(hub);
    const assign = (id: string, a0: number, a1: number) => {
      span.set(id, [a0, a1]);
      const kids = [...(treeChildren.get(id) ?? [])].sort(
        (p, q) => (byId.get(p)!.title < byId.get(q)!.title ? -1 : 1),
      );
      const total = kids.reduce((s, k) => s + weight.get(k)!, 0);
      let a = a0;
      for (const k of kids) {
        const b = a + ((a1 - a0) * weight.get(k)!) / total;
        assign(k, a, b);
        if (id === hub) sectors.push({ id: k, title: byId.get(k)!.title, start: a, end: b });
        a = b;
      }
    };
    assign(hub, -Math.PI / 2, -Math.PI / 2 + TAU);
  }

  const positions = new Map<string, Point>();
  const angle = new Map<string, number>();
  const rings: HubRing[] = [];
  const maxDepth = Math.max(0, ...depth.values());
  let radius = 0;
  if (hub) positions.set(hub, { x: 0, y: 0 });
  for (let d = 1; d <= maxDepth; d++) {
    const ids = [...depth].filter(([, v]) => v === d).map(([id]) => id);
    radius = Math.max(radius + STATE_RING, (ids.length * SPACING) / TAU);
    const wanted = ids.map((id) => {
      const [a0, a1] = span.get(id)!;
      return (a0 + a1) / 2;
    });
    const placed = relaxAngles(wanted, SPACING / radius);
    ids.forEach((id, i) => {
      angle.set(id, placed[i]);
      positions.set(id, { x: Math.cos(placed[i]) * radius, y: Math.sin(placed[i]) * radius });
    });
    rings.push({ radius, kind: "state" });
  }
  // state nodes the tree never reached (orphans) sit on the outer state ring
  const strays = state.filter((n) => !positions.has(n.id));
  strays.forEach((n, i) => {
    const a = norm((i / Math.max(1, strays.length)) * TAU);
    angle.set(n.id, a);
    positions.set(n.id, { x: Math.cos(a) * (radius || STATE_RING), y: Math.sin(a) * (radius || STATE_RING) });
  });

  // ---- the rim: anchor each record, then fill rings newest-first
  const anchors = new Map<string, string[]>();
  const recAngle = new Map<string, number>();
  const visibleRecords = record.filter((n) => !hidden.has(n.id));
  for (const n of visibleRecords) {
    const cites = [...new Set(citedBy.get(n.id) ?? [])].filter((s) => angle.has(s));
    if (!cites.length) continue;
    // the deepest citing claims are the most specific
    const deepest = Math.max(...cites.map((s) => depth.get(s) ?? 0));
    const chosen = cites.filter((s) => (depth.get(s) ?? 0) === deepest);
    anchors.set(n.id, chosen);
    recAngle.set(n.id, circularMean(chosen.map((s) => angle.get(s)!))!);
  }
  const recordIds = new Set(visibleRecords.map((n) => n.id));
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    for (const n of visibleRecords) {
      if (recAngle.has(n.id)) continue;
      const near = [...(parents.get(n.id) ?? []), ...(children.get(n.id) ?? [])].filter(
        (m) => recordIds.has(m) && recAngle.has(m),
      );
      const mean = circularMean(near.map((m) => recAngle.get(m)!));
      if (mean !== null) {
        recAngle.set(n.id, mean);
        anchors.set(n.id, []);
        changed = true;
      }
    }
    if (!changed) break;
  }
  visibleRecords
    .filter((n) => !recAngle.has(n.id))
    .forEach((n, i) => recAngle.set(n.id, norm(i * 2.399963))); // golden angle

  const time = (n: GraphNode) => Date.parse(n.createdAt ?? "") || 0;
  const newestFirst = [...visibleRecords].sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : 1));
  // Slot packing, newest first: each record takes the free slot nearest its anchor on
  // the innermost ring that has one within reach, so a claim's evidence stacks outward
  // as a spoke (newest against the claim) instead of smearing round the circle.
  const bandStart = (radius || 0) + STATE_RING * 1.1;
  const slots: { r: number; used: Uint8Array }[] = [];
  const ringAt = (k: number) => {
    while (slots.length <= k) {
      const r = bandStart + slots.length * RECORD_RING;
      const n = Math.max(8, Math.floor(((TAU * r) / SPACING) * RECORD_FILL));
      slots.push({ r, used: new Uint8Array(n) });
    }
    return slots[k];
  };
  const REACH = 0.06; // radians a record may drift from its anchor before it moves outward
  for (const n of newestFirst) {
    const want = recAngle.get(n.id)!;
    for (let k = 0; ; k++) {
      const ring = ringAt(k);
      const size = ring.used.length;
      const centre = Math.round((want / TAU) * size) % size;
      const reach = Math.max(1, Math.round((REACH / TAU) * size));
      let slot = -1;
      for (let d = 0; d <= reach && slot < 0; d++)
        for (const c of d ? [centre - d, centre + d] : [centre]) {
          const i = ((c % size) + size) % size;
          if (!ring.used[i]) {
            slot = i;
            break;
          }
        }
      if (slot < 0) continue;
      ring.used[slot] = 1;
      const a = (slot / size) * TAU;
      positions.set(n.id, { x: Math.cos(a) * ring.r, y: Math.sin(a) * ring.r });
      break;
    }
  }
  for (const ring of slots) rings.push({ radius: ring.r, kind: "record" });
  const outer = slots.length ? slots[slots.length - 1].r : bandStart;
  const extent = Math.max(STATE_RING, outer) + NODE_RADIUS * 2;
  return { hub, positions, kind, depth, anchors, rings, sectors, bandStart, extent, hidden };
}
