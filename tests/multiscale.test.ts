import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAtlas, atlasFrontier } from "../src/multiscale";
import {
  debugDefaults,
  generateDebugGraph,
  settingsFromUrl,
  debugQuery,
} from "../src/debug-graphs";
import { demoGraph } from "../src/demo";
import { layoutGraph } from "../src/layout";

test("small atlas preserves existing radial positions and every relationship", () => {
  const atlas = buildAtlas(demoGraph.nodes, demoGraph.edges);
  const original = layoutGraph(demoGraph.nodes, demoGraph.edges);
  const frontier = atlasFrontier(atlas, 0.1);
  assert.equal(frontier.items.length, demoGraph.nodes.length);
  for (const region of frontier.items) {
    assert(region.node);
    assert.deepEqual(
      { x: region.x, y: region.y },
      original.get(region.node.id),
    );
  }
  assert.equal(
    frontier.links.reduce((sum, e) => sum + e.count, 0),
    demoGraph.edges.length,
  );
});

test("every LOD partitions all nodes exactly once and conserves directed edge counts", () => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    lod: true,
    shape: "random",
    count: 1200,
    crossLinks: true,
  });
  const before = JSON.stringify(graph);
  const atlas = buildAtlas(graph.nodes, graph.edges);
  const geometry = JSON.stringify([...atlas.regions.values()]);
  for (const zoom of [0.0001, 0.01, 0.1, 1, 10]) {
    const frontier = atlasFrontier(atlas, zoom);
    const members = frontier.items.flatMap((r) => r.members);
    assert.equal(members.length, graph.nodes.length);
    assert.equal(new Set(members).size, graph.nodes.length);
    assert.equal(frontier.owner.size, graph.nodes.length);
    assert.equal(
      frontier.links.reduce((sum, e) => sum + e.count, 0) +
        [...frontier.internal.values()].reduce((a, b) => a + b, 0),
      graph.edges.length,
    );
    for (const edge of graph.edges) {
      const source = frontier.owner.get(edge.source),
        target = frontier.owner.get(edge.target);
      if (source !== target)
        assert(
          frontier.links.some(
            (e) => e.source === source && e.target === target,
          ),
        );
    }
  }
  assert.equal(JSON.stringify([...atlas.regions.values()]), geometry);
  assert.equal(JSON.stringify(graph), before);
});

test("10,000-node extreme shapes have finite, bounded, nonoverlapping neighborhoods", () => {
  for (const shape of [
    "tree",
    "chain",
    "star",
    "islands",
    "random",
    "cycle",
  ] as const) {
    const graph = generateDebugGraph({
      ...debugDefaults,
      lod: true,
      shape,
      count: 10000,
    });
    assert.equal(graph.nodes.length, 10000);
    const atlas = buildAtlas(graph.nodes, graph.edges);
    for (const region of atlas.regions.values()) {
      assert(
        Number.isFinite(region.x) &&
          Number.isFinite(region.y) &&
          Number.isFinite(region.radius),
      );
      if (region.children[0]?.node)
        for (const node of region.children)
          for (const other of region.children) {
            if (node === other) continue;
            assert(
              Math.hypot(node.x - other.x, node.y - other.y) >=
                node.radius + other.radius,
              "local node glyphs must not overlap after normalization",
            );
          }
      if (!region.children.length || region.children[0].node) continue;
      assert(region.children.length <= 6);
      for (const child of region.children) {
        assert(
          Math.hypot(child.x - region.x, child.y - region.y) + child.radius <=
            region.radius + 0.001,
        );
        for (const other of region.children) {
          if (other === child) continue;
          assert(
            Math.hypot(other.x - child.x, other.y - child.y) >=
              other.radius + child.radius - 0.001,
          );
        }
      }
    }
    const overview = atlasFrontier(atlas, 440 / atlas.root.radius, 100);
    assert(overview.items.length <= 100);
    assert.equal(overview.owner.size, 10000);
  }
});

test("citations never alter the atlas geometry; empty graphs and loops are retained", () => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    shape: "tree",
    count: 100,
  });
  const citation = {
    id: "citation",
    source: graph.nodes[99].id,
    target: graph.nodes[0].id,
    kind: "semantic" as const,
    relation: "citation" as const,
  };
  assert.deepEqual(
    buildAtlas(graph.nodes, graph.edges).root,
    buildAtlas(graph.nodes, [...graph.edges, citation]).root,
  );
  assert.equal(atlasFrontier(buildAtlas([], []), 1).items.length, 0);
  const loops = generateDebugGraph({
    ...debugDefaults,
    shape: "loops",
    count: 20,
  });
  const frontier = atlasFrontier(buildAtlas(loops.nodes, loops.edges), 1);
  assert.equal(
    frontier.links.reduce((sum, e) => sum + e.count, 0),
    loops.edges.length,
  );
  assert(frontier.links.some((e) => e.source === e.target));
});

test("large synthetic settings replay in URLs without removing the legacy or dense caps", () => {
  const settings = settingsFromUrl(
    new URLSearchParams("lod=1&shape=tree&count=10000"),
  );
  assert.equal(settings.count, 10000);
  assert.deepEqual(settingsFromUrl(debugQuery(settings)), settings);
  assert.equal(
    settingsFromUrl(new URLSearchParams("shape=tree&count=10000")).count,
    200,
  );
  assert.equal(
    settingsFromUrl(new URLSearchParams("lod=1&shape=dense&count=10000")).count,
    60,
  );
});
