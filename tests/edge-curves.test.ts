import { test } from "node:test";
import assert from "node:assert/strict";
import { outwardBend } from "../src/edge-curves";
import { layoutGraph } from "../src/layout";
import { demoGraph } from "../src/demo";

test("demo edges bow outward regardless of endpoint order or relationship type", () => {
  const positions = layoutGraph(demoGraph.nodes, demoGraph.edges);
  for (const edge of demoGraph.edges) {
    const source = positions.get(edge.source)!;
    const target = positions.get(edge.target)!;
    const bend = outwardBend(source, target);
    if (!bend) continue;
    assert.equal(outwardBend(target, source), -bend);
    const dx = target.x - source.x,
      dy = target.y - source.y;
    const length = Math.hypot(dx, dy);
    const midpoint = {
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2,
    };
    // At t=0.5, a quadratic curve moves halfway toward its control-point offset.
    const curveMiddle = {
      x: midpoint.x - ((dy / length) * bend) / 2,
      y: midpoint.y + ((dx / length) * bend) / 2,
    };
    assert(
      Math.hypot(curveMiddle.x, curveMiddle.y) >
        Math.hypot(midpoint.x, midpoint.y),
      edge.id,
    );
  }
  assert(
    outwardBend(positions.get("record")!, positions.get("experiment")!) < 0,
  );
  assert(outwardBend(positions.get("record")!, positions.get("result")!) < 0);
});

test("center spokes and coincident endpoints do not acquire an arbitrary curl", () => {
  assert.equal(outwardBend({ x: 0, y: 0 }, { x: 100, y: 100 }), 0);
  assert.equal(outwardBend({ x: -100, y: 0 }, { x: 100, y: 0 }), 0);
  assert.equal(outwardBend({ x: 100, y: 100 }, { x: 100, y: 100 }), 0);
});
