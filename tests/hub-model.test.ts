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
