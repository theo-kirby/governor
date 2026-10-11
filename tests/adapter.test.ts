import { test } from "node:test";
import assert from "node:assert/strict";
import { FlywheelAdapter, type Runner } from "../server/adapter";
const head = `sha256:${"a".repeat(64)}`;
const nextHead = `sha256:${"b".repeat(64)}`;
const status = {
  repository_id: "synthetic-repository",
  heads: { workspace: head },
  staging: { operation_count: 2 },
};
const node = (id: string, parent: string | null = null, count = 0) => ({
  node_id: id,
  title: id,
  container_node_id: parent,
  child_count: parent ? 0 : 2,
  scoped_edge_count: count,
  lifecycle_state: "live",
});
const edge = {
  edge_id: "edge",
  graph_node_id: "root",
  source_node_id: "one",
  target_node_id: "two",
  source_lifecycle_state: "live",
  target_lifecycle_state: "live",
  content: "supports",
};

test("reads all committed pages with head guards and keeps semantic edges distinct", async () => {
  const calls: { command: string; args: string[] }[] = [];
  const runner: Runner = async (command, _repo, args = []) => {
    calls.push({ command, args });
    if (command === "repo:status") return status;
    if (command === "repo:tag:list")
      return { at_head: head, next_cursor: null, tags: [] };
    assert.ok(args.includes("--at_head"));
    assert.ok(args.includes(head));
    if (command === "repo:node:list")
      return args.includes("--after")
        ? { at_head: head, next_cursor: null, nodes: [node("two", "root")] }
        : {
            at_head: head,
            next_cursor: "256",
            nodes: [node("root", null, 1), node("one", "root")],
          };
    return { at_head: head, next_cursor: null, edges: [edge] };
  };
  const snapshot = await new FlywheelAdapter(runner).snapshot("/synthetic");
  assert.equal(snapshot.nodes.length, 3);
  assert.equal(
    snapshot.edges.filter((e) => e.kind === "containment").length,
    2,
  );
  assert.equal(snapshot.edges.filter((e) => e.kind === "semantic").length, 1);
  assert.equal(snapshot.stagedOperations, 2);
  assert.ok(calls.every((c) => !c.args.includes("--staged")));
  assert.equal(calls.filter((c) => c.command === "repo:edge:list").length, 1);
});

test("rejects a commit change between pages rather than presenting mixed state", async () => {
  const runner: Runner = async (command, _repo, args = []) =>
    command === "repo:status"
      ? status
      : {
          at_head: args.includes("--after") ? nextHead : head,
          next_cursor: args.includes("--after") ? null : "256",
          nodes: [node("one")],
        };
  await assert.rejects(
    new FlywheelAdapter(runner).snapshot("/synthetic"),
    /repository changed/,
  );
});

test("rejects a commit change at final verification", async () => {
  let statuses = 0;
  const runner: Runner = async (command) =>
    command === "repo:status"
      ? { ...status, heads: { workspace: ++statuses === 1 ? head : nextHead } }
      : { at_head: head, next_cursor: null, nodes: [] };
  await assert.rejects(
    new FlywheelAdapter(runner).snapshot("/synthetic"),
    /repository changed/,
  );
});

test("rejects repeated cursors instead of looping forever", async () => {
  const runner: Runner = async (command) =>
    command === "repo:status"
      ? status
      : { at_head: head, next_cursor: "256", nodes: [] };
  await assert.rejects(
    new FlywheelAdapter(runner).snapshot("/synthetic"),
    /invalid pagination cursor/,
  );
});

test("filters tombstones and their semantic edges", async () => {
  const runner: Runner = async (command) =>
    command === "repo:tag:list"
      ? { at_head: head, next_cursor: null, tags: [] }
      : command === "repo:status"
        ? status
        : command === "repo:edge:list"
          ? {
              at_head: head,
              next_cursor: null,
              edges: [{ ...edge, target_lifecycle_state: "tombstoned" }],
            }
          : {
              at_head: head,
              next_cursor: null,
              nodes: [
                node("root", null, 1),
                node("one", "root"),
                { ...node("two", "root"), lifecycle_state: "tombstoned" },
              ],
            };
  const snapshot = await new FlywheelAdapter(runner).snapshot("/synthetic");
  assert.equal(snapshot.nodes.length, 2);
  assert.ok(snapshot.edges.every((e) => e.kind === "containment"));
});

test("loads paginated scoped tags, including leaf scopes, and caches them only for the same commit", async () => {
  let current = head;
  let tagCalls = 0;
  const runner: Runner = async (command, _repo, args = []) => {
    if (command === "repo:status")
      return { ...status, heads: { workspace: current } };
    assert(args.includes(current));
    if (command === "repo:node:list")
      return {
        at_head: current,
        next_cursor: null,
        nodes: [node("root"), node("leaf", "root")],
      };
    assert.equal(command, "repo:tag:list");
    tagCalls++;
    const tag = (id: string, name: string, state = "active") => ({
      tag_id: id,
      name,
      state,
      scope_node_id: args[0],
      holders: [{ node_id: "leaf" }, { node_id: "missing" }],
    });
    return {
      at_head: current,
      next_cursor:
        args[0] === "root" && !args.includes("--after") ? "256" : null,
      tags:
        args[0] === "leaf"
          ? [tag("same-id", "Leaf-scoped")]
          : args.includes("--after")
            ? [tag("page-two", "Verified")]
            : [tag("same-id", "Active"), tag("retired", "Old", "retired")],
    };
  };
  const adapter = new FlywheelAdapter(runner);
  const result = await adapter.snapshot("/synthetic");
  assert.deepEqual(
    result.nodes
      .find((n) => n.id === "leaf")!
      .tags?.map((t) => [t.scope, t.id, t.name]),
    [
      ["root", "same-id", "Active"],
      ["root", "page-two", "Verified"],
      ["leaf", "same-id", "Leaf-scoped"],
    ],
  );
  assert.equal(tagCalls, 3);
  await adapter.snapshot("/synthetic");
  assert.equal(tagCalls, 3);
  current = nextHead;
  await adapter.snapshot("/synthetic");
  assert.equal(tagCalls, 6);
});

test("initial topology skips tag scans and enrichment rejects a different commit", async () => {
  const calls: string[] = [];
  const adapter = new FlywheelAdapter(async (command) => {
    calls.push(command);
    if (command === "repo:status") return status;
    assert.equal(command, "repo:node:list");
    return { at_head: head, next_cursor: null, nodes: [node("root")] };
  });
  const result = await adapter.snapshot("/synthetic", false);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].tags, undefined);
  assert.equal(calls.includes("repo:tag:list"), false);
  calls.length = 0;
  await assert.rejects(
    adapter.snapshot("/synthetic", true, nextHead),
    /repository changed/,
  );
  assert.deepEqual(calls, ["repo:status"]);
});
