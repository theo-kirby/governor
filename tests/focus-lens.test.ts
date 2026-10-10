import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAtlas } from "../src/multiscale";
import { focusFrontier, projectFocus } from "../src/focus-lens";
import { debugDefaults, generateDebugGraph } from "../src/debug-graphs";

test("every focus preserves all nodes and all directed relationships in context", () => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    lod: true,
    shape: "random",
    count: 1200,
    crossLinks: true,
  });
  const atlas = buildAtlas(graph.nodes, graph.edges);
  for (const region of atlas.regions.values()) {
    const view = focusFrontier(atlas, region.id);
    const ids = view.items.flatMap((item) => item.members);
    assert.equal(ids.length, 1200);
    assert.equal(new Set(ids).size, 1200);
    assert.equal(
      view.links.reduce((sum, link) => sum + link.count, 0) +
        [...view.internal.values()].reduce((a, b) => a + b, 0),
      graph.edges.length,
    );
    assert.equal(
      view.detail.reduce((sum, item) => sum + item.members.length, 0),
      region.members.length,
    );
    assert(
      view.context.every(
        (item) => !item.members.some((id) => region.members.includes(id)),
      ),
    );
  }
});

test("10,000-node drill-down keeps focus and context within the screen", () => {
  for (const shape of ["tree", "chain", "star", "islands"] as const) {
    const graph = generateDebugGraph({
      ...debugDefaults,
      shape,
      count: 10000,
      lod: true,
    });
    const atlas = buildAtlas(graph.nodes, graph.edges);
    let focus = atlas.root;
    while (focus.children.length) {
      const view = projectFocus(atlas, focus.id, 1200, 800);
      assert.equal(view.owner.size, 10000);
      for (const point of view.points.values()) {
        assert(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert(point.x - point.radius >= 0 && point.x + point.radius <= 1200);
        assert(point.y - point.radius >= 0 && point.y + point.radius <= 800);
      }
      focus = focus.children[0];
    }
  }
});

test("empty and small graphs work without artificial context groups", () => {
  const empty = buildAtlas([], []);
  assert.equal(projectFocus(empty, empty.root.id, 500, 400).items.length, 0);
  const graph = generateDebugGraph({
    ...debugDefaults,
    shape: "tree",
    count: 30,
  });
  const atlas = buildAtlas(graph.nodes, graph.edges);
  const view = projectFocus(atlas, atlas.root.id, 500, 400);
  assert.equal(view.detail.length, 30);
  assert.equal(view.context.length, 0);
});
