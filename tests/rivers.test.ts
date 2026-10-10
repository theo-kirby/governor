import { test } from "node:test";
import assert from "node:assert/strict";
import { riverLayout } from "../src/rivers";
import { generateDebugGraph, debugDefaults } from "../src/debug-graphs";

for (const shape of [
  "chain",
  "star",
  "diamond",
  "cycle",
  "islands",
  "empty",
  "loops",
] as const) {
  test(`rivers preserve every node and edge in ${shape}`, () => {
    const { nodes, edges } = generateDebugGraph({
      ...debugDefaults,
      shape,
      count: 80,
    });
    const result = riverLayout(nodes, edges, {
      fold: 8,
      ranker: "network-simplex",
    });
    assert.equal(result.positions.size, nodes.length);
    assert.equal(result.routes.size, edges.length);
    assert.equal(new Set(result.threads.flat()).size, nodes.length);
    const points = [...result.positions.values()];
    for (const p of points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(
        p.x >= 0 && p.x <= result.width && p.y >= 0 && p.y <= result.height,
      );
    }
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++)
        assert.ok(
          Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) >=
            29,
        );
    for (const edge of edges) {
      const route = result.routes.get(edge.id)!;
      assert.deepEqual(route[0], result.positions.get(edge.source));
      assert.deepEqual(route.at(-1), result.positions.get(edge.target));
    }
  });
}
test("citations and tags do not change river placement", () => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    shape: "tree",
    count: 60,
  });
  const before = riverLayout(graph.nodes, graph.edges, {
    fold: 10,
    ranker: "tight-tree",
  });
  const after = riverLayout(
    graph.nodes.map((n) => ({ ...n, tags: [{ id: "tag", name: "open" }] })),
    [
      ...graph.edges,
      {
        id: "citation",
        source: graph.nodes[5].id,
        target: graph.nodes[30].id,
        kind: "semantic",
        relation: "citation",
      },
    ],
    { fold: 10, ranker: "tight-tree" },
  );
  assert.deepEqual(after.positions, before.positions);
});
