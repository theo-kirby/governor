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
import { layoutFlywheel } from "../src/flywheel-model";

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
      const positions = layoutFlywheel(graph.nodes, graph.edges).positions;
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
    tagRate: 0.7,
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
});
