import test from "node:test";
import assert from "node:assert/strict";
import { generateGraph } from "../src/generated-graph";
import { defaultSettings } from "../src/hub-settings";

test("procedural graphs preserve counts, depth, unique citations and deterministic seeds", () => {
  for (const depth of [1, 3, 5]) {
    const settings = {...defaultSettings, graphSource: "procedural" as const, graphStates: 100, graphRecords: 80, graphDepth: depth, graphBranches: 2, graphCitations: 6};
    const graph = generateGraph(settings);
    assert.deepEqual(graph, generateGraph(settings));
    assert.equal(graph.nodes.length, 181);
    assert.equal(graph.edges.filter(e => e.relation === "citation").length, 480);
    assert.equal(new Set(graph.edges.map(e => `${e.source}:${e.target}`)).size, graph.edges.length);
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    for (const node of graph.nodes) {
      let parent = node.parentId, level = 0;
      while (parent) {level++; parent = byId.get(parent)!.parentId;}
      assert.ok(level <= depth);
    }
    assert.notDeepEqual(graph, generateGraph({...settings, graphSeed: 43}));
  }
});
test("small and random graphs remain valid", () => {
  const graph = generateGraph({...defaultSettings, graphSource: "procedural", graphStates: 1, graphRecords: 2, graphCitations: 6});
  assert.equal(graph.edges.length, 3);
  const settings = {...defaultSettings, graphSource: "random" as const};
  assert.deepEqual(generateGraph(settings), generateGraph(settings));
});
