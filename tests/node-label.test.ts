import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeLabel } from "../src/node-label";
import type { GraphNode } from "../shared/types";

test("node labels display multiple tags, bound overflow, and allow independent visibility", () => {
  const node: GraphNode = {
    id: "test",
    title: "Experiment",
    parentId: null,
    childCount: 0,
    edgeCount: 0,
    lifecycle: "live",
    tags: ["active", "review", "verified"].map((name) => ({ id: name, name })),
  };
  assert.equal(nodeLabel(node), "Experiment\n#active · #review +1");
  assert.equal(nodeLabel(node, true, false), "Experiment");
  assert.equal(nodeLabel(node, false, true), "#active · #review +1");
  assert.equal(nodeLabel(node, false, false), "");
});
