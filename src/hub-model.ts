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
 *
 * Claims under one parent are ordered by status, so claims of one status sit together.
 * `groups` hold the claims of each status, and the records: each is drawn as a blob
 * round its nodes (a metaball outline) that joins nodes close enough to one another.
 */
export type Kind = "root" | "state" | "record" | "plan" | "other";
export type HubRing = { radius: number; kind: "state" | "record" };
export type HubSector = {
  id: string;
  title: string;
  start: number;
  end: number;
};
/** The nodes of one status (or the records), and the blob outline round them. */
export type HubGroup = {
  kind: "status" | "record";
  status?: string;
  ids: string[];
  /** Closed outlines in layout coordinates; fill them even-odd, since a ring of nodes leaves a hole. */
  loops: Point[][];
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
  groups: HubGroup[];
  bandStart: number;
  extent: number;
  hidden: Set<string>;
};

export const NODE_RADIUS = 36;
const STATE_RING = 190;
const SPACING = NODE_RADIUS * 2.6;
const RECORD_RING = NODE_RADIUS * 2.2;
const RECORD_FILL = 0.8;
const TAU = Math.PI * 2;

export function kindOf(node: GraphNode): Kind {
  for (const tag of node.tags ?? []) {
    const name = tag.id.startsWith("graph:")
      ? tag.id.slice(6)
      : tag.name.startsWith("kind:")
        ? tag.name.slice(5)
        : null;
    if (name === "root" || name === "state" || name === "record" || name === "plan") return name;
  }
  return "other";
}

/** Statuses in the order their arcs run round the wheel; anything else after them. */
export const STATUS_ORDER = ["working", "open", "broken", "blocked", "done", "superseded"];

export function statusOf(node: GraphNode): string | undefined {
  return (
    node.tags?.find((t) => t.id.startsWith("status:"))?.id.slice(7) ??
    node.tags?.find((t) => t.name.startsWith("status:"))?.name.slice(7)
  );
}

/** How far a blob reaches past each node, and how readily neighbours join (0 to 1: higher joins farther). */
export const BLOB = {
  state: { reach: NODE_RADIUS * 1.15 + 22, join: 0.25 },
  record: { reach: NODE_RADIUS * 0.75 + 18, join: 0.75 },
  /** How hard another group's node pushes a blob away, so neighbouring colours stay apart. */
  avoid: 0.6,
};

/**
 * The outline of a metaball field round `centres`: each centre adds (1 - d²/R²)² within
 * R, and the outline is where the sum reaches `join`. A lone centre gets a circle of
 * radius `reach`; two centres merge into one blob when they are within about
 * 2R·sqrt(1 - sqrt(join / 2)) of each other. Each of `avoid` takes BLOB.avoid of the
 * same kernel away, so a blob bends round other groups' nodes. Traced by marching squares.
 */
export function blobLoops(centres: Point[], reach: number, join: number, avoid: Point[] = []): Point[][] {
  if (!centres.length) return [];
  const R = reach / Math.sqrt(1 - Math.sqrt(join));
  const R2 = R * R;
  const cell = reach / 5;
  const x0 = Math.min(...centres.map((c) => c.x)) - R - 2 * cell,
    y0 = Math.min(...centres.map((c) => c.y)) - R - 2 * cell;
  const nx = Math.ceil((Math.max(...centres.map((c) => c.x)) + R + 2 * cell - x0) / cell) + 1,
    ny = Math.ceil((Math.max(...centres.map((c) => c.y)) + R + 2 * cell - y0) / cell) + 1;
  const f = new Float32Array(nx * ny);
  for (const [c, w] of [...centres.map((c) => [c, 1] as const), ...avoid.map((c) => [c, -BLOB.avoid] as const)]) {
    const i0 = Math.max(0, Math.floor((c.x - R - x0) / cell)),
      i1 = Math.min(nx - 1, Math.ceil((c.x + R - x0) / cell));
    const j0 = Math.max(0, Math.floor((c.y - R - y0) / cell)),
      j1 = Math.min(ny - 1, Math.ceil((c.y + R - y0) / cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + i * cell - c.x,
          dy = y0 + j * cell - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const t = 1 - d2 / R2;
          f[j * nx + i] += w * t * t;
        }
      }
  }
  // edge ids: horizontal (i,j)-(i+1,j) is j*nx+i; vertical (i,j)-(i,j+1) is nx*ny + j*nx+i
  const H = nx * ny;
  const at = (e: number): Point => {
    const v = e >= H,
      k = v ? e - H : e;
    const i = k % nx,
      j = Math.floor(k / nx);
    const a = f[k],
      b = v ? f[k + nx] : f[k + 1];
    const t = (join - a) / (b - a);
    return v ? { x: x0 + i * cell, y: y0 + (j + t) * cell } : { x: x0 + (i + t) * cell, y: y0 + j * cell };
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const tl = f[j * nx + i] >= join,
        tr = f[j * nx + i + 1] >= join,
        br = f[(j + 1) * nx + i + 1] >= join,
        bl = f[(j + 1) * nx + i] >= join;
      const top = j * nx + i,
        right = H + j * nx + i + 1,
        bottom = (j + 1) * nx + i,
        left = H + j * nx + i;
      const cut = [tl !== tr && top, tr !== br && right, br !== bl && bottom, bl !== tl && left].filter(
        (e): e is number => e !== false,
      );
      if (cut.length === 2) link(cut[0], cut[1]);
      else if (cut.length === 4) {
        // a saddle: the centre's value decides which corners the outline cuts off
        const centre =
          (f[j * nx + i] + f[j * nx + i + 1] + f[(j + 1) * nx + i + 1] + f[(j + 1) * nx + i]) / 4 >= join;
        if (tr !== centre) {
          link(top, right);
          link(bottom, left);
        } else {
          link(left, top);
          link(right, bottom);
        }
      }
    }
  const loops: Point[][] = [];
  const seen = new Set<number>();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Point[] = [];
    let prev = -1,
      cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(at(cur));
      const [a, b] = links.get(cur)!;
      const next = a !== prev ? a : b;
      prev = cur;
      cur = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

const statusRank = (node: GraphNode) => {
  const i = STATUS_ORDER.indexOf(statusOf(node) ?? "");
  return i < 0 ? STATUS_ORDER.length : i;
};

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
    } else if (e.relation === "citation") {
      // claim → record citations and record → claim impacts both tie a record to a claim
      const [claim, rec] =
        kind.get(e.source) === "state" && kind.get(e.target) === "record"
          ? [e.source, e.target]
          : kind.get(e.source) === "record" && kind.get(e.target) === "state"
            ? [e.target, e.source]
            : [null, null];
      if (claim && rec) (citedBy.get(rec) ?? citedBy.set(rec, []).get(rec)!).push(claim);
    }
  }

  // ---- the state tree (first parent wins; others stay drawn as edges)
  const state = nodes.filter((n) => kind.get(n.id) === "state");
  const record = nodes.filter((n) => kind.get(n.id) === "record");
  // a governor graph has one root; a graph without one has a state root and a record root
  const projectRoot = nodes.find((n) => kind.get(n.id) === "root") ?? null;
  const stateRoots = state.filter(
    (n) => !(parents.get(n.id) ?? []).some((p) => kind.get(p) === "state" || kind.get(p) === "root"),
  );
  const hub = projectRoot?.id ?? stateRoots[0]?.id ?? null;
  if (projectRoot) kind.set(projectRoot.id, "state"); // the tree walk below starts at the hub
  // without a project root, the record root is the record graph's own anchor; the hub stands in for it
  if (!projectRoot)
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
    for (const r of stateRoots.slice(projectRoot ? 0 : 1)) {
      if (depth.has(r.id)) continue;
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
      const kids = [...(treeChildren.get(id) ?? [])].sort((p, q) => {
        const a = byId.get(p)!,
          b = byId.get(q)!;
        return statusRank(a) - statusRank(b) || (a.title < b.title ? -1 : 1);
      });
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
  const bandStart = (radius || 0) + STATE_RING * 0.8;
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

  // ---- the groups: the claims of each status, then the records, each with its blob
  const groups: HubGroup[] = [];
  const byStatus = new Map<string, string[]>();
  for (const n of state) {
    const st = statusOf(n);
    if (!st || n.id === hub || hidden.has(n.id) || !positions.has(n.id)) continue;
    (byStatus.get(st) ?? byStatus.set(st, []).get(st)!).push(n.id);
  }
  const ranked = [...byStatus].sort(
    ([a], [b]) => (STATUS_ORDER.indexOf(a) + 1 || 99) - (STATUS_ORDER.indexOf(b) + 1 || 99),
  );
  for (const [status, ids] of ranked) {
    const others = ranked.filter(([st]) => st !== status).flatMap(([, rest]) => rest);
    if (hub && positions.has(hub)) others.push(hub);
    groups.push({
      kind: "status",
      status,
      ids,
      loops: blobLoops(
        ids.map((id) => positions.get(id)!),
        BLOB.state.reach,
        BLOB.state.join,
        others.map((id) => positions.get(id)!),
      ),
    });
  }
  const placedRecords = visibleRecords.filter((n) => positions.has(n.id)).map((n) => n.id);
  if (placedRecords.length)
    groups.push({
      kind: "record",
      ids: placedRecords,
      loops: blobLoops(placedRecords.map((id) => positions.get(id)!), BLOB.record.reach, BLOB.record.join),
    });
  return { hub, positions, kind, depth, anchors, rings, sectors, groups, bandStart, extent, hidden };
}
