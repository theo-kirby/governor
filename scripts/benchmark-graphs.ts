import { performance } from "node:perf_hooks";
import { generateDebugGraph, debugDefaults } from "../src/debug-graphs";
import { buildAtlas, atlasFrontier } from "../src/multiscale";

// Synthetic only. Timing is diagnostic rather than a machine-dependent test gate.
const rows = [];
for (const count of [40, 1000, 10000]) {
  for (const shape of ["tree", "chain", "star", "random", "islands"] as const) {
    const graph = generateDebugGraph({
      ...debugDefaults,
      lod: true,
      shape,
      count,
      crossLinks: shape === "random",
    });
    const start = performance.now();
    const atlas = buildAtlas(graph.nodes, graph.edges);
    const built = performance.now();
    const frontier = atlasFrontier(atlas, 390 / atlas.root.radius, 100);
    const finished = performance.now();
    const represented = frontier.items.reduce(
      (sum, item) => sum + item.members.length,
      0,
    );
    const accountedEdges =
      frontier.links.reduce((sum, edge) => sum + edge.count, 0) +
      [...frontier.internal.values()].reduce((a, b) => a + b, 0);
    if (represented !== count || accountedEdges !== graph.edges.length)
      throw new Error(`Lost data in ${shape}/${count}`);
    rows.push({
      shape,
      nodes: count,
      edges: graph.edges.length,
      "build ms": +(built - start).toFixed(1),
      "frontier ms": +(finished - built).toFixed(1),
      "overview items": frontier.items.length,
      "aggregate links": frontier.links.length,
    });
  }
}
console.table(rows);
