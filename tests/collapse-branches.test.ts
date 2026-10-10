import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseBranches } from "../src/collapse-branches";
import { generateDebugGraph, debugDefaults } from "../src/debug-graphs";

test("nested summaries bound wide trees and partition every original node exactly once", () => {
  for (const shape of [
    "tree",
    "star",
    "random",
    "research",
    "cycle",
    "islands",
  ] as const) {
    const g = generateDebugGraph({ ...debugDefaults, shape, count: 1000 });
    const before = JSON.stringify(g),
      c = collapseBranches(g.nodes, g.edges);
    assert(c.nodes.length <= 40, `${shape}: ${c.nodes.length}`);
    assert.equal(c.owner.size, 1000);
    const represented = c.nodes.flatMap((n) => c.groups.get(n.id) || [n.id]);
    assert.equal(represented.length, 1000);
    assert.equal(new Set(represented).size, 1000);
    const ids = new Set(c.nodes.map((n) => n.id));
    assert(c.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
    assert.equal(JSON.stringify(g), before);
  }
});
test("opening a branch reveals bounded children and repeated expansion recovers all original nodes", () => {
  const g = generateDebugGraph({
    ...debugDefaults,
    shape: "tree",
    count: 1000,
  });
  const expanded = new Set<string>();
  let c = collapseBranches(g.nodes, g.edges, expanded);
  const initial = c.nodes.length;
  const first = [...c.groups.keys()][0];
  expanded.add(first);
  c = collapseBranches(g.nodes, g.edges, expanded);
  assert(c.nodes.length > initial);
  assert(c.nodes.length <= initial + 10);
  for (let i = 0; i < 20 && c.groups.size; i++) {
    for (const id of c.groups.keys()) expanded.add(id);
    c = collapseBranches(g.nodes, g.edges, expanded);
  }
  assert.equal(c.groups.size, 0);
  for (const n of g.nodes) assert(c.nodes.some((v) => v.id === n.id));
  assert.equal(c.owner.size, g.nodes.length);
});

test("explicitly revealed chain interiors stay open inside the branch projection", () => {
  const g = generateDebugGraph({
    ...debugDefaults,
    shape: "chain",
    count: 100,
  });
  const revealed = new Set(g.nodes.slice(1, -1).map((n) => n.id));
  const c = collapseBranches(g.nodes, g.edges, new Set(), revealed);
  assert.equal(c.groups.size, 0);
  assert.equal(c.nodes.length, 100);
});

test("citations sharing a tree link and original self-loops remain represented", () => {
  const g = generateDebugGraph({ ...debugDefaults, shape: "chain", count: 2 });
  g.edges.push({
    id: "cite",
    source: "debug-0",
    target: "debug-1",
    kind: "semantic",
    relation: "citation",
  });
  g.edges.push({
    id: "self",
    source: "debug-0",
    target: "debug-0",
    kind: "semantic",
    relation: "citation",
  });
  const c = collapseBranches(g.nodes, g.edges);
  assert.equal(c.edges.length, 3);
  assert.equal(c.edges.filter((e) => e.relation === "citation").length, 2);
});
