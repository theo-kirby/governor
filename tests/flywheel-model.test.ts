import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFlywheel, projectFlywheel } from "../src/flywheel-model";
import {
  debugDefaults,
  generateDebugGraph,
  type Shape,
} from "../src/debug-graphs";
import type { GraphEdge, GraphNode } from "../shared/types";
const fixture = (shape: Shape, count = 1000) =>
  generateDebugGraph({ ...debugDefaults, shape, count, crossLinks: false });

test("live-style folding preserves endpoints, expands runs, and bundles only six or more terminal siblings", () => {
  const chain = fixture("chain");
  const before = structuredClone(chain);
  const folded = projectFlywheel(chain.nodes, chain.edges);
  assert.equal(folded.nodes.length, 3);
  assert.equal(folded.groups.size, 1);
  const [id, group] = [...folded.groups][0];
  assert.equal(group.members.length, 998);
  const open = projectFlywheel(chain.nodes, chain.edges, new Set([id]));
  assert.equal(open.nodes.length, 1000);
  assert.equal(open.groups.size, 0);
  const star = fixture("star");
  const fan = projectFlywheel(star.nodes, star.edges);
  assert.equal(fan.nodes.length, 2);
  assert.equal([...fan.groups.values()][0].kind, "fan");
  assert.equal(
    projectFlywheel(star.nodes, star.edges, new Set(fan.groups.keys())).nodes
      .length,
    1000,
  );
  const small = fixture("star", 6);
  assert.equal(projectFlywheel(small.nodes, small.edges).groups.size, 0);
  assert.deepEqual(chain, before);
});

test("all large fixture families remain represented exactly once, with valid endpoints and finite positions", () => {
  for (const shape of [
    "tree",
    "research",
    "burst",
    "teams",
    "star",
    "chain",
    "cycle",
    "islands",
    "random",
    "diamond",
    "loops",
    "single",
    "empty",
  ] as Shape[]) {
    const graph = fixture(shape);
    const p = projectFlywheel(graph.nodes, graph.edges);
    const ids = new Set(p.nodes.map((n) => n.id));
    const represented = p.nodes.flatMap(
      (n) => p.groups.get(n.id)?.members ?? [n.id],
    );
    assert.equal(new Set(represented).size, graph.nodes.length, shape);
    assert.equal(represented.length, graph.nodes.length, shape);
    assert(
      p.edges.every((e) => ids.has(e.source) && ids.has(e.target)),
      shape,
    );
    const layout = layoutFlywheel(p.nodes, p.edges);
    assert.equal(layout.positions.size, p.nodes.length, shape);
    for (const point of layout.positions.values())
      assert(
        Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          Math.hypot(point.x, point.y) <= layout.extent,
        shape,
      );
    const points = [...layout.positions.values()];
    for (let i = 0; i < points.length; i++)
      for (let j = 0; j < i; j++)
        assert(
          Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) >=
            72 - 1e-6,
          `${shape}: overlapping bodies`,
        );
    for (const a of layout.components)
      for (const b of layout.components)
        if (a !== b)
          assert(
            Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) >=
              a.radius + b.radius,
            shape,
          );
    assert.deepEqual(layout, layoutFlywheel(p.nodes, p.edges), shape);
  }
});

test("citation cross-links do not fuse separate orbital components or change their layout", () => {
  const nodes: GraphNode[] = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    title: String(i),
    parentId: null,
    childCount: 0,
    edgeCount: 0,
    lifecycle: "live",
  }));
  const edges: GraphEdge[] = [
    { id: "a", source: "0", target: "1", kind: "semantic", relation: "parent" },
    { id: "b", source: "2", target: "3", kind: "semantic", relation: "parent" },
  ];
  const citation: GraphEdge = {
    id: "citation",
    source: "1",
    target: "3",
    kind: "semantic",
    relation: "citation",
  };
  const base = layoutFlywheel(nodes, edges);
  assert.equal(base.components.length, 6);
  assert.deepEqual(layoutFlywheel(nodes, [...edges, citation]), base);
  const p = projectFlywheel(nodes, [...edges, citation]);
  assert(p.edges.some((e) => e.id === "citation"));
});
