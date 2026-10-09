import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { resolve, basename, dirname, join } from "node:path";
import { access, realpath } from "node:fs/promises";
import { z } from "zod";
import type { Snapshot, GraphEdge, GraphNode, NodeTag } from "../shared/types";

const exec = promisify(execFile);
export class ViewerError extends Error {
  constructor(
    message: string,
    public statusCode = 502,
  ) {
    super(message);
  }
}
export type ReadCommand =
  "repo:status" | "repo:node:list" | "repo:edge:list" | "repo:tag:list";
export type Runner = (
  command: ReadCommand,
  repo: string,
  args?: string[],
) => Promise<unknown>;
const allowed = new Set<ReadCommand>([
  "repo:status",
  "repo:node:list",
  "repo:edge:list",
  "repo:tag:list",
]);
export const runCli: Runner = async (command, repo, args = []) => {
  if (!allowed.has(command))
    throw new ViewerError("Unsupported read command.", 400);
  const binary = process.env.FLYWHEEL_BIN || "flywheel";
  try {
    const { stdout } = await exec(
      binary,
      [command, ...args, "--repo", repo, "--format=json"],
      {
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `${join(homedir(), ".local/bin")}:${process.env.PATH || ""}`,
        },
      },
    );
    return JSON.parse(stdout);
  } catch (error) {
    const failure = error as {
      code?: string;
      stdout?: string;
      stderr?: string;
    };
    if (failure.code === "ENOENT")
      throw new ViewerError(
        "Flywheel CLI not found. Install it or set FLYWHEEL_BIN.",
      );
    let payload;
    for (const output of [failure.stdout, failure.stderr]) {
      try {
        payload = JSON.parse(output || "")?.error;
        if (payload) break;
      } catch {
        /* Not CLI JSON. */
      }
    }
    const code = String(payload?.code || "");
    const message = String(
      payload?.message ||
        "Flywheel read failed or timed out. Check the repository and CLI.",
    );
    if (/head|cursor/i.test(code + message))
      throw new ViewerError(
        "The repository changed. Refresh to load its current committed state.",
        409,
      );
    throw new ViewerError(message);
  }
};

export async function resolveRepo(input: string): Promise<string> {
  const expanded =
    input === "~"
      ? homedir()
      : input.startsWith("~/")
        ? join(homedir(), input.slice(2))
        : input;
  let repo = resolve(expanded);
  if (basename(repo) === ".flywheel") repo = dirname(repo);
  try {
    repo = await realpath(repo);
    await access(join(repo, ".flywheel", "db.sqlite"));
    return repo;
  } catch {
    throw new ViewerError(
      "No Flywheel repository found here. Choose a folder containing .flywheel/db.sqlite.",
      400,
    );
  }
}

const head = z.string().nullable();
const statusSchema = z.object({
  repository_id: z.string(),
  heads: z.object({ workspace: head }),
  staging: z.object({ operation_count: z.number() }),
});
const nodeSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  container_node_id: z.string().nullable(),
  child_count: z.number(),
  scoped_edge_count: z.number(),
  lifecycle_state: z.string(),
});
const edgeSchema = z.object({
  edge_id: z.string(),
  graph_node_id: z.string(),
  source_node_id: z.string(),
  target_node_id: z.string(),
  content: z.string().nullable().optional(),
  source_lifecycle_state: z.string(),
  target_lifecycle_state: z.string(),
});
const tagSchema = z.object({
  tag_id: z.string(),
  scope_node_id: z.string(),
  name: z.string(),
  state: z.enum(["active", "retired"]),
  holders: z.array(z.object({ node_id: z.string() })),
});
const pageSchema = z.object({
  at_head: head,
  next_cursor: z.string().nullable(),
});
function checkHead(actual: string | null, expected: string | null) {
  if (actual !== expected)
    throw new ViewerError(
      "The repository changed. Refresh to load its current committed state.",
      409,
    );
}

export class FlywheelAdapter {
  private tagCache = new Map<string, Map<string, NodeTag[]>>();
  constructor(private run: Runner = runCli) {}
  private async pages(
    command: "repo:node:list" | "repo:edge:list" | "repo:tag:list",
    repo: string,
    expected: string | null,
    args: string[] = [],
  ) {
    const results: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const flags = [
        ...args,
        ...(expected ? ["--at_head", expected] : []),
        ...(cursor ? ["--after", cursor] : []),
      ];
      const raw = await this.run(command, repo, flags);
      const page = pageSchema.parse(raw);
      checkHead(page.at_head, expected);
      const field =
        command === "repo:node:list"
          ? "nodes"
          : command === "repo:tag:list"
            ? "tags"
            : "edges";
      results.push(
        ...z.object({ [field]: z.array(z.unknown()) }).parse(raw)[field],
      );
      cursor = page.next_cursor;
      if (cursor !== null) {
        if (!expected || seen.has(cursor))
          throw new ViewerError(
            "Flywheel returned an invalid pagination cursor.",
          );
        seen.add(cursor);
      }
    } while (cursor !== null);
    return results;
  }
  async snapshot(
    repo: string,
    includeTags = true,
    requestedHead?: string,
  ): Promise<Snapshot> {
    const status = statusSchema.parse(await this.run("repo:status", repo));
    const expected = status.heads.workspace;
    if (requestedHead !== undefined) checkHead(expected, requestedHead);
    const rows = (await this.pages("repo:node:list", repo, expected)).map(
      (row) => nodeSchema.parse(row),
    );
    const nodes: GraphNode[] = rows
      .filter((n) => n.lifecycle_state === "live")
      .map((n) => ({
        id: n.node_id,
        title: n.title,
        parentId: n.container_node_id,
        childCount: n.child_count,
        edgeCount: n.scoped_edge_count,
        lifecycle: n.lifecycle_state,
      }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges: GraphEdge[] = nodes
      .filter((n) => n.parentId && ids.has(n.parentId))
      .map((n) => ({
        id: `containment:${n.id}`,
        source: n.parentId!,
        target: n.id,
        kind: "containment",
      }));
    // Counts identify scopes, avoiding a CLI subprocess for every leaf node.
    for (const scope of nodes.filter((n) => n.edgeCount > 0)) {
      const rows = await this.pages("repo:edge:list", repo, expected, [
        scope.id,
      ]);
      for (const row of rows) {
        const e = edgeSchema.parse(row);
        if (
          e.source_lifecycle_state === "live" &&
          e.target_lifecycle_state === "live" &&
          ids.has(e.source_node_id) &&
          ids.has(e.target_node_id)
        ) {
          edges.push({
            id: `semantic:${e.edge_id}`,
            source: e.source_node_id,
            target: e.target_node_id,
            kind: "semantic",
            scope: e.graph_node_id,
            content: e.content,
          });
        }
      }
    }
    if (includeTags) {
      const cacheKey = `${repo}\0${expected}`;
      let tagsByNode = this.tagCache.get(cacheKey);
      if (!tagsByNode) {
        tagsByNode = new Map<string, NodeTag[]>();
        // A tag can be scoped to any node, even a leaf. The CLI has no global tag
        // index, so read every scope with at most four subprocesses in flight.
        for (let offset = 0; offset < rows.length; offset += 4) {
          const pages = await Promise.all(
            rows
              .slice(offset, offset + 4)
              .map((scope) =>
                this.pages("repo:tag:list", repo, expected, [scope.node_id]),
              ),
          );
          for (const page of pages)
            for (const raw of page) {
              const tag = tagSchema.parse(raw);
              if (tag.state !== "active") continue;
              for (const holder of tag.holders) {
                if (!ids.has(holder.node_id)) continue;
                const tags = tagsByNode.get(holder.node_id) || [];
                if (
                  !tags.some(
                    (existing) =>
                      existing.id === tag.tag_id &&
                      existing.scope === tag.scope_node_id,
                  )
                )
                  tags.push({
                    id: tag.tag_id,
                    name: tag.name,
                    scope: tag.scope_node_id,
                  });
                tagsByNode.set(holder.node_id, tags);
              }
            }
        }
        if (this.tagCache.size >= 4)
          this.tagCache.delete(this.tagCache.keys().next().value!);
        this.tagCache.set(cacheKey, tagsByNode);
      }
      for (const node of nodes) node.tags = tagsByNode.get(node.id) || [];
    }
    const final = statusSchema.parse(await this.run("repo:status", repo));
    checkHead(final.heads.workspace, expected);
    return {
      repo,
      repositoryId: status.repository_id,
      head: expected,
      stagedOperations: final.staging.operation_count,
      nodes,
      edges,
      loadedAt: new Date().toISOString(),
    };
  }
}
