import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseChains } from "../src/collapse-chains";
import { generateDebugGraph, debugDefaults } from "../src/debug-graphs";

test("linear interiors collapse with both endpoints retained, and expand losslessly", () => {
  const g = generateDebugGraph({
    ...debugDefaults,
    shape: "chain",
    count: 1000,
  });
  const before = JSON.stringify(g);
  const collapsed = collapseChains(g.nodes, g.edges);
  assert.equal(collapsed.nodes.length, 3);
  assert.equal(collapsed.edges.length, 2);
  assert(collapsed.nodes.some((n) => n.id === "debug-0"));
  assert(collapsed.nodes.some((n) => n.id === "debug-999"));
  const [id, members] = [...collapsed.groups][0];
  assert.equal(members.length, 998);
  assert.equal(collapsed.edges[0].source, "debug-0");
  assert.equal(collapsed.edges[0].target, id);
  assert.equal(collapsed.edges[1].source, id);
  assert.equal(collapsed.edges[1].target, "debug-999");
  const expanded = collapseChains(g.nodes, g.edges, new Set([id]));
  assert.deepEqual(expanded.nodes, g.nodes);
  assert.deepEqual(expanded.edges, g.edges);
  assert.equal(JSON.stringify(g), before);
});

test("external citations retain identity and direction and internal citations restore on expansion", () => {
  const g = generateDebugGraph({ ...debugDefaults, shape: "chain", count: 8 });
  g.edges.push({
    id: "cite",
    source: "debug-3",
    target: "debug-0",
    kind: "semantic",
    relation: "citation",
  });
  g.edges.push({
    id: "internal",
    source: "debug-4",
    target: "debug-2",
    kind: "semantic",
    relation: "citation",
  });
  const c = collapseChains(g.nodes, g.edges),
    id = [...c.groups.keys()][0];
  assert.equal(c.edges.find((e) => e.id === "cite")!.source, id);
  assert.equal(c.edges.find((e) => e.id === "cite")!.target, "debug-0");
  assert(!c.edges.some((e) => e.id === "internal"));
  assert.deepEqual(
    collapseChains(g.nodes, g.edges, new Set([id])).edges,
    g.edges,
  );
});

test("forks, merges and cycles are never hidden as chain interiors", () => {
  for (const shape of ["tree", "diamond", "cycle", "loops"] as const) {
    const g = generateDebugGraph({ ...debugDefaults, shape, count: 100 });
    const c = collapseChains(g.nodes, g.edges);
    assert.equal(c.groups.size, 0, shape);
    assert.deepEqual(c.nodes, g.nodes);
    assert.deepEqual(c.edges, g.edges);
  }
  const g = generateDebugGraph({ ...debugDefaults, shape: "chain", count: 12 });
  g.edges.push({
    id: "merge",
    source: "debug-0",
    target: "debug-6",
    kind: "containment",
  });
  const c = collapseChains(g.nodes, g.edges);
  assert(c.nodes.some((n) => n.id === "debug-6"));
  assert.equal(c.groups.size, 2);
});
