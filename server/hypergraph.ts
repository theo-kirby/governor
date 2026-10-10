import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import { ViewerError } from "./adapter";
import type { Snapshot, GraphNode, GraphEdge } from "../shared/types";

const metadata = z.object({
  node_id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  parents: z.array(z.string()).default([]),
});
function yaml(text: string) {
  const document = parseDocument(text);
  if (document.errors.length) throw new Error("Invalid YAML");
  return document.toJS({ maxAliasCount: 0 });
}
async function within(root: string, path: string) {
  const actual = await realpath(path);
  const rel = relative(root, actual);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw new ViewerError(
      "Hypergraph paths must stay inside the repository.",
      400,
    );
  return actual;
}
export async function hypergraphSnapshot(
  repo: string,
  options: { view?: string; citations?: boolean } = {},
): Promise<Snapshot> {
  repo = await realpath(repo);
  const configPath = await within(repo, join(repo, ".hypergraph/config.yml"));
  const configText = await readFile(configPath, "utf8");
  let config: { graph_dir: string };
  try {
    config = z
      .object({ graph_dir: z.string().default(".hypergraph/graph") })
      .parse(yaml(configText));
  } catch {
    throw new ViewerError("Invalid .hypergraph/config.yml.", 400);
  }
  const root = await within(repo, resolve(repo, config.graph_dir));
  async function files() {
    const paths: string[] = [];
    async function walk(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
          throw new ViewerError(
            "Hypergraph graph files must not be symlinks.",
            400,
          );
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && entry.name.endsWith(".md")) paths.push(path);
        if (paths.length > 10000)
          throw new ViewerError(
            "Hypergraph exceeds the 10,000-node read limit.",
            400,
          );
      }
    }
    await walk(root);
    return paths.sort();
  }
  const paths = await files();
  const rows: {
    meta: z.infer<typeof metadata>;
    group: string;
    body: string;
    path: string;
    version: string;
  }[] = [];
  for (let offset = 0; offset < paths.length; offset += 16) {
    rows.push(
      ...(await Promise.all(
        paths.slice(offset, offset + 16).map(async (path) => {
          const info = await stat(path);
          if (info.size > 2 * 1024 * 1024)
            throw new ViewerError(
              "Hypergraph node exceeds the 2 MB read limit.",
              400,
            );
          const text = await readFile(path, "utf8");
          const match = text.match(
            /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/,
          );
          try {
            if (!match) throw new Error("Missing frontmatter");
            return {
              meta: metadata.parse(yaml(match[1])),
              body: match[2],
              group: relative(root, path).split(/[\\/]/)[0],
              path,
              version: `${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
            };
          } catch {
            throw new ViewerError(
              `Invalid Hypergraph node: ${relative(root, path)}.`,
              400,
            );
          }
        }),
      )),
    );
  }
  const bySlug = new Map<string, (typeof rows)[number]>();
  const ids = new Set<string>();
  for (const row of rows) {
    const key = `${row.group}/${row.meta.slug}`;
    if (bySlug.has(key) || ids.has(row.meta.node_id))
      throw new ViewerError("Duplicate Hypergraph node ID or graph/slug.", 400);
    bySlug.set(key, row);
    ids.add(row.meta.node_id);
  }
  const nodes: GraphNode[] = rows.map(({ meta, group, body }) => {
    const status = body
      .match(/^Status:\s*([a-z][a-z-]*)\s*$/im)?.[1]
      .toLowerCase();
    return {
      id: meta.node_id,
      title: meta.title,
      parentId: null,
      childCount: 0,
      edgeCount: 0,
      lifecycle: "live",
      tags: [
        { id: `graph:${group}`, name: group },
        ...(status ? [{ id: `status:${status}`, name: status }] : []),
      ],
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  let unresolvedCitations = 0;
  for (const row of rows) {
    const node = byId.get(row.meta.node_id)!;
    for (const slug of new Set(row.meta.parents)) {
      const parent = bySlug.get(`${row.group}/${slug}`);
      if (!parent)
        throw new ViewerError(
          `Missing Hypergraph parent ${slug} in ${row.group}.`,
          400,
        );
      node.parentId ??= parent.meta.node_id;
      byId.get(parent.meta.node_id)!.childCount++;
      edges.push({
        id: `parent:${parent.meta.node_id}:${node.id}`,
        source: parent.meta.node_id,
        target: node.id,
        kind: "semantic",
        relation: "parent",
        scope: row.group,
      });
    }
    const citations = new Set<string>();
    for (const match of row.body.matchAll(
      /\[(rec|state|plan):\s*([a-zA-Z0-9_-]+)\s*\]/g,
    )) {
      const key = `${match[1] === "rec" ? "record" : match[1]}/${match[2]}`;
      if (citations.has(key)) continue;
      citations.add(key);
      const target = bySlug.get(key);
      if (!target) {
        unresolvedCitations++;
        continue;
      }
      edges.push({
        id: `citation:${node.id}:${target.meta.node_id}`,
        source: node.id,
        target: target.meta.node_id,
        kind: "semantic",
        relation: "citation",
        scope: row.group,
      });
    }
  }
  for (const edge of edges) byId.get(edge.source)!.edgeCount++;
  // Reject a moving working tree instead of returning a mixture of file versions.
  const after = await files();
  if (
    JSON.stringify(after) !== JSON.stringify(paths) ||
    (await readFile(configPath, "utf8")) !== configText
  )
    throw new ViewerError(
      "The Hypergraph changed during loading. Refresh to retry.",
      409,
    );
  for (const row of rows) {
    const info = await stat(row.path);
    if (`${info.size}:${info.mtimeMs}:${info.ctimeMs}` !== row.version)
      throw new ViewerError(
        "The Hypergraph changed during loading. Refresh to retry.",
        409,
      );
  }
  if (options.view && !rows.some((row) => row.group === options.view))
    throw new ViewerError(`Unknown Hypergraph view: ${options.view}.`, 400);
  const visibleNodes = options.view
    ? nodes.filter((node) =>
        node.tags?.some((tag) => tag.id === `graph:${options.view}`),
      )
    : nodes;
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter(
    (edge) =>
      visibleIds.has(edge.source) &&
      visibleIds.has(edge.target) &&
      (options.citations !== false || edge.relation !== "citation"),
  );
  for (const node of visibleNodes) node.edgeCount = 0;
  for (const edge of visibleEdges) byId.get(edge.source)!.edgeCount++;
  return {
    repo,
    repositoryId: `hypergraph:${repo}`,
    source: "hypergraph",
    head: null,
    stagedOperations: 0,
    nodes: visibleNodes,
    edges: visibleEdges,
    loadedAt: new Date().toISOString(),
    warnings: unresolvedCitations
      ? [`${unresolvedCitations} unresolved citations omitted.`]
      : [],
  };
}
