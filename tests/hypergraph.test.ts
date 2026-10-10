import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hypergraphSnapshot } from "../server/hypergraph";
import { createApp } from "../server/app";
import { layoutGraph } from "../src/layout";

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), "hypergraph-viewer-"));
  for (const group of ["record", "state", "plan"])
    await mkdir(join(repo, `.hypergraph/graph/${group}`), { recursive: true });
  await writeFile(
    join(repo, ".hypergraph/config.yml"),
    "graph_dir: .hypergraph/graph\n",
  );
  const put = async (
    group: string,
    slug: string,
    parents: string[] = [],
    body = "",
    id = `${group}-${slug}`,
  ) => {
    await writeFile(
      join(repo, `.hypergraph/graph/${group}/${slug}.md`),
      `---\nnode_id: ${id}\nslug: ${slug}\ntitle: 'Quoted: ${slug}'\nparents: ${JSON.stringify(parents)}\n---\n${body}`,
    );
  };
  return { repo, put };
}

test("Hypergraph reads working-tree nodes, multiple parents, citations and status tags without changing files", async () => {
  const { repo, put } = await fixture();
  try {
    await put("record", "root");
    await put("record", "a", ["root"]);
    await put("record", "b", ["root", "a"]);
    await put(
      "state",
      "root",
      [],
      "Status: open\n[rec: b] [rec: b] [rec: missing]\nPrivate body",
    );
    await put("plan", "root", [], "[state: root]");
    const path = join(repo, ".hypergraph/graph/state/root.md");
    const original = await readFile(path, "utf8");
    const graph = await hypergraphSnapshot(repo);
    assert.equal(graph.source, "hypergraph");
    assert.equal(graph.head, null);
    assert.equal(graph.nodes.length, 5);
    assert.equal(graph.edges.filter((e) => e.relation === "parent").length, 3);
    assert.equal(
      graph.edges.filter((e) => e.relation === "citation").length,
      2,
    );
    assert.equal(
      graph.nodes.find((n) => n.id === "state-root")!.tags?.[1].name,
      "open",
    );
    assert.deepEqual(graph.warnings, ["1 unresolved citations omitted."]);
    assert(!JSON.stringify(graph).includes("Private body"));
    assert.equal(await readFile(path, "utf8"), original);
    assert.deepEqual(
      layoutGraph(graph.nodes, graph.edges),
      layoutGraph(
        graph.nodes,
        graph.edges.filter((e) => e.relation === "parent"),
      ),
    );
    const state = await hypergraphSnapshot(repo, {
      view: "state",
      citations: false,
    });
    assert.equal(state.nodes.length, 1);
    assert.equal(state.edges.length, 0);
    const parentsOnly = await hypergraphSnapshot(repo, { citations: false });
    assert.equal(parentsOnly.edges.length, 3);
    await assert.rejects(
      hypergraphSnapshot(repo, { view: "unknown" }),
      /Unknown Hypergraph view/,
    );
    const app = createApp();
    try {
      for (const path of [repo, join(repo, ".hypergraph")]) {
        const response = await app.inject({
          url: `/api/graph?repo=${encodeURIComponent(path)}`,
          headers: { host: "127.0.0.1:4311", "x-flywheel-viewer": "1" },
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.json().source, "hypergraph");
      }
    } finally {
      await app.close();
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("Hypergraph rejects missing parents, duplicate IDs, malformed YAML, and symlinked files", async () => {
  const { repo, put } = await fixture();
  const file = join(repo, ".hypergraph/graph/record/a.md");
  try {
    await put("record", "root");
    await put("record", "a", ["missing"]);
    await assert.rejects(hypergraphSnapshot(repo), /Missing Hypergraph parent/);
    await put("record", "a", [], "", "record-root");
    await assert.rejects(hypergraphSnapshot(repo), /Duplicate Hypergraph/);
    await writeFile(file, "---\nnode_id: [\n---\n");
    await assert.rejects(hypergraphSnapshot(repo), /Invalid Hypergraph node/);
    await rm(file);
    await symlink(join(repo, ".hypergraph/graph/record/root.md"), file);
    await assert.rejects(hypergraphSnapshot(repo), /symlinks/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
