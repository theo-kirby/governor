// A whole-graph snapshot from the repository log (docs/CONVENTIONS.md, "Reading fast").
// The log carries every operation and each node's initial values, so one paginated read
// rebuilds topology, tags and record bodies. Only nodes whose fields changed after
// creation (state, plans, the root) need a `node:get`, and edges come from one
// `edge:list` on the root. Snapshots are cached in `.governor/snapshot.json` by head.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Flywheel } from "./flywheel";
import { FOLDED, KINDS, recordedAt, ROOT_TAG, STATUSES, type Kind, type Status } from "./model";

export type GNode = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  /** creation order in the log (0 = first node ever) */
  seq: number;
  createdIn: string;
  /** messages of commits that set a field after creation */
  editedBy: string[];
  live: boolean;
  parents: string[];
  children: string[];
  container: string | null;
  tags: string[];
  kind: Kind | "root" | null;
  status: Status | null;
  folded: boolean;
  /** ISO time from the `## Recorded` section, when the node has one */
  at: string | null;
};
export type GEdge = { id: string; source: string; target: string; content: string };
export type Commit = { id: string; message: string; nodes: string[]; tagged: { node: string; tag: string; op: "assign" | "remove" }[] };
export type GraphSnapshot = {
  version: 1;
  head: string | null;
  repositoryId: string | null;
  root: string | null;
  nodes: Record<string, GNode>;
  edges: GEdge[];
  tagIds: Record<string, string>;
  commits: Commit[];
};

const SNAPSHOT_VERSION = 1;

export async function snapshot(fw: Flywheel, opts: { cache?: boolean } = {}): Promise<GraphSnapshot> {
  const status = await fw.call("repo:status");
  const head: string | null = status.heads?.workspace ?? null;
  const cachePath = join(fw.repo, ".governor", "snapshot.json");
  if (opts.cache !== false && head) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as GraphSnapshot;
      if (cached.version === SNAPSHOT_VERSION && cached.head === head) return cached;
    } catch {
      /* no cache */
    }
  }
  const snap = await build(fw, head, status.repository_id ?? null);
  if (opts.cache !== false && head) {
    await mkdir(join(fw.repo, ".governor"), { recursive: true });
    await writeFile(cachePath, JSON.stringify(snap));
  }
  return snap;
}

async function build(fw: Flywheel, head: string | null, repositoryId: string | null): Promise<GraphSnapshot> {
  const commits: any[] = [];
  if (head) {
    let after: string | undefined;
    for (;;) {
      const page = await fw.call("repo:log", "--limit", "256", ...(after ? ["--after", after] : []));
      commits.push(...page.commits);
      after = page.next_cursor ?? undefined;
      if (!after) break;
    }
  }
  commits.reverse(); // oldest first
  const nodes: Record<string, GNode> = {};
  const tagIds: Record<string, string> = {};
  const holders: Record<string, Set<string>> = {}; // tag id → node ids
  const dirty = new Set<string>();
  const out: Commit[] = [];
  let seq = 0;
  for (const c of commits) {
    const touched = new Set<string>();
    const tagged: Commit["tagged"] = [];
    for (const op of c.operations as any[]) {
      switch (op.type) {
        case "node.create.v1": {
          const v = op.initial_values ?? {};
          const str = (x: unknown) => (x === null || x === undefined || x === "None" ? "" : String(x));
          nodes[op.node_id] = {
            id: op.node_id,
            slug: str(v.slug_name),
            title: str(v.title),
            summary: str(v.summary),
            content: str(v.content),
            seq: seq++,
            createdIn: c.commit_id,
            editedBy: [],
            live: true,
            parents: [],
            children: [],
            container: null,
            tags: [],
            kind: null,
            status: null,
            folded: false,
            at: null,
          };
          touched.add(op.node_id);
          break;
        }
        case "node.field.set.v1":
          if (nodes[op.node_id]) {
            dirty.add(op.node_id);
            nodes[op.node_id].editedBy.push(c.message ?? "");
            touched.add(op.node_id);
          }
          break;
        case "node.tombstone.v1":
          if (nodes[op.node_id]) nodes[op.node_id].live = false;
          break;
        case "node.restore.v1":
          if (nodes[op.node_id]) nodes[op.node_id].live = true;
          break;
        case "lineage.add.v1": {
          const p = nodes[op.parent_node_id],
            ch = nodes[op.child_node_id];
          if (p && ch && !ch.parents.includes(p.id)) {
            ch.parents.push(p.id);
            p.children.push(ch.id);
          }
          break;
        }
        case "lineage.remove.v1": {
          const p = nodes[op.parent_node_id],
            ch = nodes[op.child_node_id];
          if (p && ch) {
            ch.parents = ch.parents.filter((x) => x !== p.id);
            p.children = p.children.filter((x) => x !== ch.id);
          }
          break;
        }
        case "containment.assign.v1":
          if (nodes[op.child_node_id]) nodes[op.child_node_id].container = op.container_node_id;
          break;
        case "containment.remove.v1":
          if (nodes[op.child_node_id]) nodes[op.child_node_id].container = null;
          break;
        case "tag.define.v1":
        case "tag.update.v1":
          if (op.definition?.name) tagIds[op.tag_id] = op.definition.name;
          break;
        case "node.tag.assign.v1":
          (holders[op.tag_id] ??= new Set()).add(op.node_id);
          if (op.expected_holder && op.expected_holder !== op.node_id) holders[op.tag_id].delete(op.expected_holder);
          tagged.push({ node: op.node_id, tag: op.tag_id, op: "assign" });
          touched.add(op.node_id);
          break;
        case "node.tag.remove.v1":
          holders[op.tag_id]?.delete(op.node_id);
          tagged.push({ node: op.node_id, tag: op.tag_id, op: "remove" });
          touched.add(op.node_id);
          break;
      }
    }
    out.push({ id: c.commit_id, message: c.message ?? "", nodes: [...touched], tagged });
  }
  for (const [tagId, ids] of Object.entries(holders))
    for (const id of ids) if (nodes[id] && tagIds[tagId]) nodes[id].tags.push(tagIds[tagId]);
  // current values for anything edited after creation
  for (const id of dirty) {
    const n = (await fw.call("repo:node:get", id)).node;
    const str = (x: unknown) => (x === null || x === undefined ? "" : String(x));
    Object.assign(nodes[id], { slug: str(n.slug_name), title: str(n.title), summary: str(n.summary), content: str(n.content) });
  }
  const root = Object.values(nodes).find((n) => n.tags.includes(ROOT_TAG) && n.live)?.id ?? null;
  for (const n of Object.values(nodes)) {
    n.kind = n.id === root ? "root" : ((KINDS as readonly string[]).find((k) => n.tags.includes(k)) as Kind) ?? null;
    n.status = ((STATUSES as readonly string[]).find((s) => n.tags.includes(s)) as Status) ?? null;
    n.folded = n.tags.includes(FOLDED);
    n.at = recordedAt(n.content);
  }
  const edges: GEdge[] = [];
  if (root) {
    let after: string | undefined;
    for (;;) {
      const page = await fw.call("repo:edge:list", root, ...(after ? ["--after", after, "--at_head", head!] : []));
      for (const e of page.edges)
        edges.push({ id: e.edge_id, source: e.source_node_id, target: e.target_node_id, content: e.content ?? "" });
      after = page.next_cursor ?? undefined;
      if (!after) break;
    }
  }
  return { version: SNAPSHOT_VERSION, head, repositoryId, root, nodes, edges, tagIds, commits: out };
}

// ---- conveniences over a snapshot
export const live = (s: GraphSnapshot) => Object.values(s.nodes).filter((n) => n.live);
export const ofKind = (s: GraphSnapshot, k: Kind) => live(s).filter((n) => n.kind === k);
export function bySlug(s: GraphSnapshot): Map<string, GNode> {
  return new Map(live(s).filter((n) => n.slug).map((n) => [n.slug, n]));
}
export function resolve(s: GraphSnapshot, ref: string): GNode | null {
  if (ref === "root") return s.root ? s.nodes[s.root] : null;
  return s.nodes[ref] ?? bySlug(s).get(ref) ?? null;
}
export function tail(s: GraphSnapshot): GNode[] {
  return ofKind(s, "record").filter((n) => !n.folded).sort((a, b) => a.seq - b.seq);
}
