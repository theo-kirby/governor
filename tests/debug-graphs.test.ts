import { test } from "node:test";
import assert from "node:assert/strict";
import {
  debugDefaults,
  debugQuery,
  generateDebugGraph,
  normalizeSettings,
  settingsFromUrl,
  shapes,
  type Shape,
} from "../src/debug-graphs";
import { layoutGraph } from "../src/layout";

test("every stress shape has unique IDs, valid endpoints, and finite radial positions", () => {
  for (const shape of Object.keys(shapes) as Shape[]) {
    for (const count of [2, 17, 200]) {
      const graph = generateDebugGraph({ ...debugDefaults, shape, count });
      const ids = new Set(graph.nodes.map((node) => node.id));
      assert.equal(ids.size, graph.nodes.length, shape);
      assert.equal(
        new Set(graph.edges.map((edge) => edge.id)).size,
        graph.edges.length,
        shape,
      );
      assert(
        graph.edges.every(
          (edge) => ids.has(edge.source) && ids.has(edge.target),
        ),
        shape,
      );
      const positions = layoutGraph(graph.nodes, graph.edges);
      assert.equal(positions.size, graph.nodes.length, shape);
      for (const position of positions.values())
        assert(
          Number.isFinite(position.x) && Number.isFinite(position.y),
          shape,
        );
    }
  }
});

test("dense fixtures are reproducible from their URL, and changing the seed changes their edges", () => {
  const settings = {
    ...debugDefaults,
    shape: "dense" as const,
    count: 40,
    seed: 765,
    density: 0.35,
    curvature: 1.8,
    labels: false,
  };
  const graph = generateDebugGraph(settings);
  assert.deepEqual(settingsFromUrl(debugQuery(settings)), settings);
  assert.deepEqual(
    generateDebugGraph(settingsFromUrl(debugQuery(settings))),
    graph,
  );
  assert.notDeepEqual(
    generateDebugGraph({ ...settings, seed: 766 }).edges,
    graph.edges,
  );
});

test("query settings are bounded and dense graphs have a practical maximum", () => {
  const settings = settingsFromUrl(
    new URLSearchParams(
      "shape=dense&count=999999&branches=-4&ringGap=NaN&spacing=-50&curvature=100&density=5",
    ),
  );
  assert.equal(settings.count, 60);
  assert.equal(settings.branches, 2);
  assert.equal(settings.ringGap, 180);
  assert.equal(settings.spacing, 50);
  assert.equal(settings.curvature, 2.5);
  assert.equal(generateDebugGraph(settings).edges.length, (60 * 59) / 2);
  assert.equal(normalizeSettings({ shape: "unknown" as Shape }).shape, "demo");
});

test("random topology and tags reproduce from a seed, and tag coverage does not change topology", () => {
  const settings = {
    ...debugDefaults,
    shape: "random" as const,
    count: 80,
    seed: 24,
    crossLinks: true,
    tags: false,
    tagRate: 0.7,
    tagFilter: "review",
  };
  const graph = generateDebugGraph(settings);
  assert.deepEqual(
    generateDebugGraph(settingsFromUrl(debugQuery(settings))),
    graph,
  );
  assert.notDeepEqual(
    generateDebugGraph({ ...settings, seed: 25 }).edges,
    graph.edges,
  );
  assert.deepEqual(
    generateDebugGraph({ ...settings, tagRate: 0 }).edges,
    graph.edges,
  );
  assert(
    generateDebugGraph({ ...settings, tagRate: 0 }).nodes.every(
      (n) => n.tags?.length === 0,
    ),
  );
  assert(
    generateDebugGraph({ ...settings, tagRate: 1 }).nodes.every(
      (n) => n.tags && n.tags.length > 0,
    ),
  );
  assert(
    graph.edges.some((e) => e.kind === "containment") &&
      graph.edges.some((e) => e.kind === "semantic"),
  );
});

test("classic layout keeps regular concentric rings and minimum spacing", () => {
  for (const shape of ["tree", "random", "lopsided", "islands"] as const) {
    for (const seed of [1, 7, 24]) {
      const graph = generateDebugGraph({
        ...debugDefaults,
        shape,
        seed,
        count: 80,
      });
      const positions = layoutGraph(graph.nodes, graph.edges, {
        adaptive: false,
      });
      const byId = new Map(graph.nodes.map((node) => [node.id, node]));
      const rootDepth =
        graph.nodes.filter((node) => !node.parentId).length === 1 ? 0 : 1;
      const rings = new Map<number, { radius: number; angle: number }[]>();
      for (const node of graph.nodes) {
        let depth = rootDepth;
        let ancestor = node;
        while (ancestor.parentId) {
          depth++;
          ancestor = byId.get(ancestor.parentId)!;
        }
        const point = positions.get(node.id)!;
        const ring = rings.get(depth) || [];
        ring.push({
          radius: Math.hypot(point.x, point.y),
          angle: (Math.atan2(point.y, point.x) + 2 * Math.PI) % (2 * Math.PI),
        });
        rings.set(depth, ring);
      }
      const step = rings.get(1)![0].radius;
      for (const [depth, ring] of rings) {
        for (const point of ring)
          assert(
            Math.abs(point.radius - step * depth) < 1e-8,
            `${shape}: consistent depth spacing`,
          );
        if (ring.length < 2) continue;
        ring.sort((a, b) => a.angle - b.angle);
        for (let i = 0; i < ring.length; i++) {
          const gap =
            (ring[(i + 1) % ring.length].angle - ring[i].angle + 2 * Math.PI) %
            (2 * Math.PI);

          assert(
            2 * ring[i].radius * Math.sin(gap / 2) >=
              debugDefaults.spacing - 1e-8,
            `${shape}: minimum spacing`,
          );
        }
      }
    }
  }
});

test("random cross-links are opt-in and do not change the containment tree", () => {
  const settings = { ...debugDefaults, shape: "random" as const, seed: 7 };
  const plain = generateDebugGraph(settings);
  const linked = generateDebugGraph({ ...settings, crossLinks: true });
  assert(plain.edges.every((edge) => edge.kind === "containment"));
  assert(linked.edges.some((edge) => edge.kind === "semantic"));
  assert.deepEqual(
    plain.edges,
    linked.edges.filter((edge) => edge.kind === "containment"),
  );
  assert.deepEqual(
    layoutGraph(plain.nodes, plain.edges),
    layoutGraph(linked.nodes, linked.edges),
  );
});

test("classic tree branches keep descendants inside their reserved sector", () => {
  for (const seed of [1, 7, 24, 81]) {
    const graph = generateDebugGraph({
      ...debugDefaults,
      shape: "random",
      count: 80,
      seed,
    });
    const positions = layoutGraph(graph.nodes, graph.edges, {
      adaptive: false,
    });
    const children = new Map(
      graph.nodes.map((node) => [node.id, [] as string[]]),
    );
    for (const edge of graph.edges)
      children.get(edge.source)!.push(edge.target);
    const angle = (id: string) => {
      const p = positions.get(id)!;
      return (Math.atan2(p.y, p.x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    };
    const leaves = (id: string): string[] =>
      children.get(id)!.length ? children.get(id)!.flatMap(leaves) : [id];
    for (const node of graph.nodes) {
      const p = positions.get(node.id)!;
      if (Math.hypot(p.x, p.y) < 1e-8) continue;
      const descendantAngles = leaves(node.id).map(angle);
      assert(angle(node.id) >= Math.min(...descendantAngles) - 1e-8);
      assert(angle(node.id) <= Math.max(...descendantAngles) + 1e-8);
    }
  }
});

test("adaptive rings preserve branch order and spacing while using independent radii", () => {
  for (const shape of ["tree", "random", "lopsided", "islands"] as const)
    for (const seed of [1, 7, 24]) {
      const graph = generateDebugGraph({
        ...debugDefaults,
        shape,
        seed,
        count: 180,
      });
      const positions = layoutGraph(graph.nodes, graph.edges, {
        compact: false,
      });
      const reference = layoutGraph(graph.nodes, graph.edges, {
        adaptive: false,
      });
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      const levels = new Map<number, string[]>();
      for (const n of graph.nodes) {
        let depth = 0,
          p = n;
        while (p.parentId) {
          depth++;
          p = byId.get(p.parentId)!;
        }
        const level = levels.get(depth) || [];
        level.push(n.id);
        levels.set(depth, level);
      }
      const angle = (p: { x: number; y: number }) =>
        (Math.atan2(p.y, p.x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
      let previous = -Infinity;
      for (const [, ids] of [...levels].sort((a, b) => a[0] - b[0])) {
        const r = Math.hypot(
          positions.get(ids[0])!.x,
          positions.get(ids[0])!.y,
        );
        assert.ok(r - previous >= debugDefaults.ringGap - 1e-8);
        previous = r;
        for (const id of ids) {
          const p = positions.get(id)!;
          assert.ok(Math.abs(Math.hypot(p.x, p.y) - r) < 1e-8);
        }
        if (ids.length < 2) continue;
        const oldOrder = [...ids].sort(
          (a, b) => angle(reference.get(a)!) - angle(reference.get(b)!),
        );
        const newOrder = [...ids].sort(
          (a, b) => angle(positions.get(a)!) - angle(positions.get(b)!),
        );
        assert.deepEqual(newOrder, oldOrder);
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            const a = positions.get(ids[i])!,
              b = positions.get(ids[j])!;
            assert.ok(
              Math.hypot(a.x - b.x, a.y - b.y) >= debugDefaults.spacing - 1e-8,
            );
          }
      }
    }
});
