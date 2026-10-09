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
