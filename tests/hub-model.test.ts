import assert from "node:assert/strict";
import test from "node:test";
import type { GraphEdge, GraphNode } from "../shared/types";
import { blobLoops, layoutHub, relaxAngles } from "../src/hub-model";

const node = (id: string, kind: string, createdAt?: string): GraphNode => ({
  id,
  title: id,
  parentId: null,
  childCount: 0,
  edgeCount: 0,
  lifecycle: "live",
  tags: [{ id: `graph:${kind}`, name: kind }],
  createdAt,
});
const parent = (a: string, b: string): GraphEdge => ({
  id: `p:${a}:${b}`,
  source: a,
  target: b,
  kind: "semantic",
  relation: "parent",
});
const cite = (a: string, b: string): GraphEdge => ({
  id: `c:${a}:${b}`,
  source: a,
  target: b,
  kind: "semantic",
  relation: "citation",
});
const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
const angle = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
const gap = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

const inside = (p: { x: number; y: number }, loop: { x: number; y: number }[]) => {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i],
      b = loop[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

function wheel() {
  const nodes = [
    node("hub", "state"),
    node("engine", "state"),
    node("ui", "state"),
    node("engine.a", "state"),
    node("rroot", "record", "2026-01-01T00:00:00Z"),
    node("r-old", "record", "2026-01-02T00:00:00Z"),
    node("r-new", "record", "2026-03-01T00:00:00Z"),
    node("r-ui", "record", "2026-02-01T00:00:00Z"),
    node("r-child", "record", "2026-02-02T00:00:00Z"),
    node("p", "plan"),
  ];
  const edges = [
    parent("hub", "engine"),
    parent("hub", "ui"),
    parent("engine", "engine.a"),
    parent("rroot", "r-old"),
    parent("r-old", "r-new"),
    parent("rroot", "r-ui"),
    parent("r-ui", "r-child"),
    cite("engine.a", "r-old"),
    cite("engine.a", "r-new"),
    cite("ui", "r-ui"),
  ];
  return { nodes, edges };
}

test("the hub is the state root at the centre; state rings sit inside the record band", () => {
  const { nodes, edges } = wheel();
  const s = layoutHub(nodes, edges);
  assert.equal(s.hub, "hub");
  assert.deepEqual(s.positions.get("hub"), { x: 0, y: 0 });
  const maxState = Math.max(...["engine", "ui", "engine.a"].map((id) => radius(s.positions.get(id)!)));
  for (const id of ["r-old", "r-new", "r-ui", "r-child"])
    assert.ok(radius(s.positions.get(id)!) >= s.bandStart - 1e-6 && s.bandStart > maxState, id);
  assert.ok(radius(s.positions.get("engine.a")!) > radius(s.positions.get("engine")!));
});

test("records sit near the claims that cite them, and uncited records borrow their parent's angle", () => {
  const { nodes, edges } = wheel();
  const s = layoutHub(nodes, edges);
  const claim = (id: string) => angle(s.positions.get(id)!);
  assert.ok(gap(angle(s.positions.get("r-ui")!), claim("ui")) < 0.6);
  assert.ok(gap(angle(s.positions.get("r-new")!), claim("engine.a")) < 0.6);
  assert.ok(gap(angle(s.positions.get("r-child")!), angle(s.positions.get("r-ui")!)) < 0.6);
  assert.deepEqual(s.anchors.get("r-child"), []);
  assert.deepEqual(s.anchors.get("r-ui"), ["ui"]);
});

test("newer records sit closer to the claims than older ones", () => {
  const nodes = [node("hub", "state"), node("c", "state"), node("rr", "record", "2025-01-01T00:00:00Z")];
  const edges = [parent("hub", "c")];
  for (let i = 0; i < 300; i++) {
    const id = `r${i}`;
    nodes.push(node(id, "record", new Date(Date.UTC(2026, 0, 1) + i * 3.6e6).toISOString()));
    edges.push(parent("rr", id), cite("c", id));
  }
  const s = layoutHub(nodes, edges);
  assert.ok(radius(s.positions.get("r299")!) < radius(s.positions.get("r0")!));
});

test("plan nodes and the record root are hidden; every other node is placed", () => {
  const { nodes, edges } = wheel();
  const s = layoutHub(nodes, edges);
  assert.ok(s.hidden.has("p") && s.hidden.has("rroot"));
  for (const n of nodes)
    if (!s.hidden.has(n.id)) {
      const p = s.positions.get(n.id)!;
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), n.id);
    }
});

test("relaxAngles keeps order and enforces the gap, wrapping around", () => {
  const out = relaxAngles([0, 0.01, 0.02, 6.27], 0.2);
  const sorted = [...out].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length] + (i + 1 === sorted.length ? 2 * Math.PI : 0);
    assert.ok(next - sorted[i] >= 0.2 - 1e-6);
  }
});

test("claims are grouped by status, records apart, and each group has its blob", () => {
  const claim = (id: string, status: string) => ({
    ...node(id, "state"),
    tags: [{ id: "graph:state", name: "state" }, { id: `status:${status}`, name: status }],
  });
  // titles alone would interleave the statuses: a-open, b-working, c-open, d-working, e-broken
  const nodes = [
    node("hub", "root"),
    claim("a", "open"),
    claim("b", "working"),
    claim("c", "open"),
    claim("d", "working"),
    claim("e", "broken"),
    node("r1", "record", "2026-01-01T00:00:00Z"),
    node("r2", "record", "2026-01-02T00:00:00Z"),
  ];
  const edges = ["a", "b", "c", "d", "e"].map((c) => parent("hub", c));
  edges.push(parent("hub", "r1"), parent("r1", "r2"), cite("a", "r1"), cite("d", "r2"));
  const s = layoutHub(nodes, edges);
  assert.deepEqual(
    s.groups.map((g) => [g.status ?? g.kind, [...g.ids].sort()]),
    [
      ["working", ["b", "d"]],
      ["open", ["a", "c"]],
      ["broken", ["e"]],
      ["record", ["r1", "r2"]],
    ],
  );
  for (const g of s.groups)
    for (const id of g.ids)
      assert.ok(
        g.loops.some((loop) => inside(s.positions.get(id)!, loop)),
        `${id} sits inside its ${g.status ?? g.kind} blob`,
      );
});

test("a blob is a circle round a lone node and joins two nodes only when they are close", () => {
  const [one] = blobLoops([{ x: 0, y: 0 }], 50, 0.25);
  for (const p of one) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 50) < 2, `${p.x},${p.y}`);
  const near = blobLoops([{ x: 0, y: 0 }, { x: 90, y: 0 }], 50, 0.25);
  assert.equal(near.length, 1);
  assert.ok(inside({ x: 45, y: 0 }, near[0]), "the neck between them is inside");
  assert.equal(blobLoops([{ x: 0, y: 0 }, { x: 400, y: 0 }], 50, 0.25).length, 2);
  // a ring of nodes leaves a hole: an outer and an inner outline
  const ring = Array.from({ length: 24 }, (_, k) => ({
    x: Math.cos((k * Math.PI) / 12) * 300,
    y: Math.sin((k * Math.PI) / 12) * 300,
  }));
  assert.equal(blobLoops(ring, 50, 0.25).length, 2);
});

test("the organic layout keeps the hub centred and is the same on every load", () => {
  const { nodes, edges } = wheel();
  const a = layoutHub(nodes, edges, { organic: true }), b = layoutHub(nodes, edges, { organic: true });
  assert.deepEqual([...a.positions], [...b.positions]);
  assert.deepEqual(a.positions.get("hub"), { x: 0, y: 0 });
  const placed = [...a.positions].filter(([id]) => !a.hidden.has(id)).map(([, p]) => p);
  for (const p of placed) assert.ok(radius(p) + 36 <= a.extent, "every node fits inside the extent");
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++)
      assert.ok(Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y) > 36, "no two nodes overlap");
});

for (const statePacking of ["compact", "compact-staggered", "compact-tight", "compact-evidence", "compact-evidence-roomy", "disc"] as const) {
  test(`${statePacking} packs a crowded level without overlaps, preserves depth and keeps evidence outside`, () => {
    const nodes = [node("hub", "root")];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 120; i++) {
      nodes.push(node(`s${i}`, "state"));
      edges.push(parent("hub", `s${i}`));
    }
    nodes.push(node("child", "state"), node("r", "record"));
    edges.push(parent("s0", "child"), cite("child", "r"));
    const base = layoutHub(nodes, edges);
    const packed = layoutHub(nodes, edges, { statePacking });
    assert.deepEqual(packed.positions, layoutHub(nodes, edges, { statePacking }).positions);
    assert.deepEqual(packed.positions.get("hub"), { x: 0, y: 0 });
    const states = nodes.filter(n => n.id.startsWith("s")).map(n => packed.positions.get(n.id)!);
    assert.ok(Math.max(...states.map(radius)) < radius(base.positions.get("s0")!) * 0.6);
    assert.ok(Math.min(...states.map(radius)) < radius(base.positions.get("s0")!) * 0.25);
    assert.ok(radius(packed.positions.get("child")!) > Math.max(...states.map(radius)));
    assert.ok(radius(packed.positions.get("r")!) > radius(packed.positions.get("child")!));
    const all = [...packed.positions.values()];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        assert.ok(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) >= 72, `${i}, ${j} overlap`);
  });
}

test("record controls filter newest records without moving states, hide records, and reverse age order", () => {
  const nodes = [node("hub", "root"), node("claim", "state")];
  const edges = [parent("hub", "claim")];
  for (let i = 0; i < 100; i++) {
    nodes.push(node(`rec${i}`, "record", new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString()));
    edges.push(cite("claim", `rec${i}`));
  }
  const original = layoutHub(nodes, edges);
  const filtered = layoutHub(nodes, edges, { recordPercent: 10 });
  assert.equal([...filtered.positions.keys()].filter(id => id.startsWith("rec")).length, 10);
  assert.ok(filtered.hidden.has("rec0") && !filtered.hidden.has("rec99"));
  assert.deepEqual(filtered.positions.get("claim"), original.positions.get("claim"));
  const hidden = layoutHub(nodes, edges, { showRecords: false });
  assert.equal(hidden.positions.size, 2);
  const reversed = layoutHub(nodes, edges, { recordOrder: "oldest" });
  assert.ok(radius(original.positions.get("rec99")!) < radius(original.positions.get("rec0")!));
  assert.ok(radius(reversed.positions.get("rec0")!) < radius(reversed.positions.get("rec99")!));
  const spread = layoutHub(nodes, edges, { recordPlacement: "even", recordSpread: 20, recordGap: 2 });
  assert.ok(spread.bandStart > original.bandStart);
  assert.ok(spread.extent < original.extent, "even placement reduces long single-claim fingers");
});

test("state region size and connection width enlarge blobs without moving nodes", () => {
  const centres = [{ x: 0, y: 0 }, { x: 140, y: 0 }];
  assert.equal(blobLoops(centres, 50, 0.25).length, 2);
  const wider = blobLoops(centres, 50, 0.6);
  assert.equal(wider.length, 1);
  assert.ok(inside({ x: 70, y: 0 }, wider[0]));
  const enlarged = blobLoops([{ x: 0, y: 0 }], 75, 0.25);
  assert.ok(enlarged[0].every(p => radius(p) > 73));
  const { nodes, edges } = wheel();
  nodes.find(n => n.id === "engine")!.tags!.push({ id: "status:working", name: "working" });
  const before = layoutHub(nodes, edges);
  const after = layoutHub(nodes, edges, { stateBlobSize: 3, stateBlobJoin: 0.9 });
  assert.deepEqual(after.positions, before.positions);
  assert.notDeepEqual(after.groups[0].loops, before.groups[0].loops);
  for (const group of after.groups)
    for (const loop of group.loops)
      for (const point of loop) assert.ok(Number.isFinite(point.x) && radius(point) < after.extent);
});
