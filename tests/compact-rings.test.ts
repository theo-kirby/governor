import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGraph } from "../src/layout";
import {
  debugDefaults,
  generateDebugGraph,
  debugQuery,
  settingsFromUrl,
  type Shape,
} from "../src/debug-graphs";

const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
test("thousand-node research fixtures reproduce, vary by seed, and keep citations out of placement", () => {
  for (const shape of ["research", "burst", "teams"] as const) {
    const settings = {
      ...debugDefaults,
      shape,
      count: 1000,
      seed: 7,
      crossLinks: true,
    };
    const graph = generateDebugGraph(settings);
    assert.equal(graph.nodes.length, 1000);
    assert.deepEqual(
      generateDebugGraph(settingsFromUrl(debugQuery(settings))),
      graph,
    );
    assert.notDeepEqual(
      generateDebugGraph({ ...settings, seed: 8 }).edges,
      graph.edges,
    );
    assert.deepEqual(
      layoutGraph(graph.nodes, graph.edges),
      layoutGraph(
        graph.nodes,
        graph.edges.filter((e) => e.relation !== "citation"),
      ),
    );
    const ids = new Set(graph.nodes.map((n) => n.id));
    assert(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
  }
});

test("compact rings separate every node across large, deep, wide, merging and cyclic graphs", () => {
  for (const shape of [
    "research",
    "burst",
    "teams",
    "random",
    "tree",
    "chain",
    "star",
    "lopsided",
    "diamond",
    "cycle",
    "islands",
  ] as Shape[]) {
    for (const seed of [1, 24]) {
      const graph = generateDebugGraph({
        ...debugDefaults,
        shape,
        count: 1000,
        seed,
      });
      const before = JSON.stringify(graph);
      const positions = layoutGraph(graph.nodes, graph.edges);
      assert.equal(positions.size, 1000);
      const points = [...positions.values()];
      for (let i = 0; i < points.length; i++) {
        assert(Number.isFinite(points[i].x) && Number.isFinite(points[i].y));
        for (let j = i + 1; j < points.length; j++)
          assert(
            Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) >=
              140 - 1e-7,
            `${shape} seed ${seed}: overlap`,
          );
      }
      if (
        ["star", "chain", "lopsided", "tree", "islands", "random"].includes(
          shape,
        )
      )
        for (const e of graph.edges.filter((e) => e.kind === "containment"))
          assert(
            radius(positions.get(e.target)!) >=
              radius(positions.get(e.source)!) - 1e-7,
          );
      assert.equal(JSON.stringify(graph), before);
    }
  }
});

test("branch-local placement keeps roots close and preserves distinct subtree sectors", () => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    shape: "tree",
    count: 1000,
  });
  const positions = layoutGraph(graph.nodes, graph.edges);
  const children = new Map(graph.nodes.map((n) => [n.id, [] as string[]]));
  for (const e of graph.edges) children.get(e.source)!.push(e.target);
  const branchAngles = (id: string): number[] => {
    const result: number[] = [];
    const queue = [id];
    for (let i = 0; i < queue.length; i++) {
      const p = positions.get(queue[i])!;
      result.push(
        (Math.atan2(p.y, p.x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI),
      );
      queue.push(...children.get(queue[i])!);
    }
    return result;
  };
  let end = -Infinity;
  for (const id of children.get("debug-0")!) {
    assert(radius(positions.get(id)!) <= 280);
    const angles = branchAngles(id);
    assert(Math.min(...angles) > end, "subtree sectors must not interleave");
    end = Math.max(...angles);
  }
  for (const edge of graph.edges)
    assert(
      radius(positions.get(edge.target)!) > radius(positions.get(edge.source)!),
      "children must remain outward of parents",
    );
});

test("a long chain retains its direction instead of filling a circular grid", () => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    shape: "chain",
    count: 1000,
  });
  const points = [...layoutGraph(graph.nodes, graph.edges).values()];
  const angle = Math.atan2(points[1].y, points[1].x);
  for (let i = 1; i < points.length; i++) {
    assert(Math.abs(Math.atan2(points[i].y, points[i].x) - angle) < 1e-8);
    assert(radius(points[i]) > radius(points[i - 1]));
  }
});
