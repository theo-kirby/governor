import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGraph } from "../src/layout";
import type { GraphNode, GraphEdge } from "../shared/types";
const node = (id: string): GraphNode => ({
  id,
  title: id,
  parentId: null,
  childCount: 0,
  edgeCount: 0,
  lifecycle: "live",
});
const edge = (
  source: string,
  target: string,
  kind: GraphEdge["kind"] = "containment",
): GraphEdge => ({ id: `${kind}:${source}:${target}`, source, target, kind });

test("radial layout centers the root and places each containment depth on a ring", () => {
  const nodes = [node("root"), node("a"), node("b"), node("c")];
  const positions = layoutGraph(nodes, [
    edge("root", "a"),
    edge("root", "b"),
    edge("a", "c"),
  ]);
  const radius = (id: string) =>
    Math.hypot(positions.get(id)!.x, positions.get(id)!.y);
  assert.equal(radius("root"), 0);
  assert.equal(radius("a"), radius("b"));
  assert(radius("c") > radius("a"));
  assert.notDeepEqual(positions.get("a"), positions.get("b"));
});

test("radial layout preserves every node across cycles, parallel edges, and disconnected components", () => {
  const nodes = [node("a"), node("b"), node("isolated")];
  const edges = [
    edge("a", "b"),
    edge("a", "b", "semantic"),
    edge("b", "a", "semantic"),
  ];
  const original = JSON.stringify({ nodes, edges });
  const positions = layoutGraph(nodes, edges);
  assert.equal(positions.size, nodes.length);
  for (const point of positions.values())
    assert(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.equal(JSON.stringify({ nodes, edges }), original);
  assert.equal(layoutGraph([], []).size, 0);
});

test("adaptive rings stay concentric, separated, ordered and compact around an uneven fork", () => {
  const nodes = [node("root")];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < 100; i++) {
    nodes.push(node(`leaf${i}`));
    edges.push(edge("root", `leaf${i}`));
  }
  for (let i = 0; i < 120; i++) {
    nodes.push(node(`deep${i}`));
    edges.push(edge(i ? `deep${i - 1}` : "leaf0", `deep${i}`));
  }
  const before = JSON.stringify({ nodes, edges });
  const compact = layoutGraph(nodes, edges, { compact: false }),
    classic = layoutGraph(nodes, edges, { adaptive: false });
  const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
  const extent = (p: Map<string, { x: number; y: number }>) =>
    Math.max(...[...p.values()].map(radius));
  assert.ok(extent(compact) < extent(classic) / 3);
  const ring = nodes
    .filter((n) => n.id.startsWith("leaf"))
    .map((n) => compact.get(n.id)!);
  for (const p of ring) assert.ok(Math.abs(radius(p) - radius(ring[0])) < 1e-8);
  for (let i = 0; i < ring.length; i++)
    for (let j = i + 1; j < ring.length; j++)
      assert.ok(
        Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y) >= 140 - 1e-8,
      );
  let previous = radius(ring[0]);
  for (let i = 0; i < 120; i++) {
    const r = radius(compact.get(`deep${i}`)!);
    assert.ok(r - previous >= 180 - 1e-8);
    previous = r;
  }
  assert.equal(JSON.stringify({ nodes, edges }), before);
  assert.deepEqual(
    layoutGraph(
      nodes,
      [
        ...edges,
        { ...edge("deep119", "leaf99", "semantic"), relation: "citation" },
      ],
      { compact: false },
    ),
    compact,
  );
});

test("small graphs retain their original radial coordinates", () => {
  const nodes = [
    node("root"),
    ...Array.from({ length: 30 }, (_, i) => node(`n${i}`)),
  ];
  const edges = nodes.slice(1).map((n) => edge("root", n.id));
  assert.deepEqual(
    layoutGraph(nodes, edges),
    layoutGraph(nodes, edges, { adaptive: false }),
  );
});
