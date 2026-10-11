// governor migrate-hypergraph: rebuild a Hypergraph project's record, state and plan graphs
// as one governor graph in an empty Flywheel repository (docs/MIGRATING.md).
//
// Reads `<from>/.hypergraph/cache/{record,state,plan}.json` (run `hypergraph export`
// first) and `<from>/.hypergraph/config.yml`. The three Hypergraph roots fold into
// the governor root; the plan root becomes a plan component. Slugs, titles,
// summaries and bodies carry over unchanged, except that `Status:` lines become tags. Each
// record gains a `## Recorded` section carrying its Hypergraph `created_at`.
// `## State Impact` lines and claims' `## Provenance` lines and `[rec: slug]` mentions
// carry over as they are: governor reads relations from content (lib/model.ts). Records
// inside the state graph's high-water mark are tagged `folded`.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { Flywheel, withLock } from "./flywheel";
import { ALL_TAGS, citations, FOLDED, parseImpacts, ROOT_TAG, sectionOf, STATUSES, TAG_STYLE } from "./model";

export { citations, parseImpacts, sectionOf };
import { snapshot } from "./snapshot";
import { GovernorError } from "./write";

export type HNode = { node_id: string; slug_name: string; title: string; content: string; summary: string; parent_ids: string[]; created_at: string; artifacts?: string[] };

const BATCH = 500;
/** Hypergraph's record body, with `## Recorded` (its created_at) before `## State Impact`,
 *  and its impact lines in governor's form (`- target: X — d` becomes `- X — d`). */
export function recordBody(n: HNode): string {
  const recorded = `## Recorded\n\n- at: ${n.created_at}\n${n.artifacts?.length ? n.artifacts.map((a) => `- artifact: ${a}\n`).join("") : ""}\n`;
  const at = n.content.search(/^## State Impact\s*$/m);
  if (at < 0) return `${n.content.trimEnd()}\n\n${recorded}`;
  const rest = n.content.slice(at);
  const end = rest.slice(1).search(/^## /m);
  const impact = end < 0 ? rest : rest.slice(0, end + 1);
  return n.content.slice(0, at) + recorded + impact.replace(/^- target:\s*/gm, "- ") + (end < 0 ? "" : rest.slice(end + 1));
}

/** A claim's body without its `Status:` line → [status, body]. */
export function claimBody(content: string): [string | null, string] {
  const lines = content.split("\n");
  const i = lines.findIndex((l) => l.trim());
  const m = i >= 0 ? lines[i].match(/^Status:\s*([a-z]+)\s*$/) : null;
  if (!m) return [null, content];
  return [m[1], lines.slice(i + 1).join("\n").replace(/^\n+/, "")];
}

const byTime = (a: HNode, b: HNode) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.slug_name < b.slug_name ? -1 : 1;

export async function migrateHypergraph(fw: Flywheel, from: string, log = (m: string) => console.log(m)): Promise<void> {
  const config = parseYaml(await readFile(join(from, ".hypergraph", "config.yml"), "utf8")) as any;
  const load = async (k: string) =>
    (JSON.parse(await readFile(join(from, ".hypergraph", "cache", `${k}.json`), "utf8")).nodes as HNode[]).sort(byTime);
  const record = await load("record");
  const state = await load("state");
  const plan = await load("plan").catch(() => [] as HNode[]);
  const before = await snapshot(fw, { cache: false });
  if (before.root || Object.keys(before.nodes).length)
    throw new GovernorError("migrate into an empty Flywheel repository (`flywheel repo:init <dir>`)");

  const recordRoot = record.find((n) => n.slug_name === config.record_root?.slug) ?? record.find((n) => !n.parent_ids.length)!;
  const stateRoot = state.find((n) => n.slug_name === config.state_root?.slug) ?? state.find((n) => !n.parent_ids.length)!;
  const planRoot = plan.find((n) => !n.parent_ids.length) ?? null;
  const all = [...record, ...state, ...plan];
  const hid = new Map(all.map((n) => [n.node_id, n]));
  const bySlug = new Map(all.map((n) => [n.slug_name, n]));
  const kindOf = new Map<string, "record" | "state" | "plan">([
    ...record.map((n) => [n.node_id, "record"] as const),
    ...state.map((n) => [n.node_id, "state"] as const),
    ...plan.map((n) => [n.node_id, "plan"] as const),
  ]);

  // folded: ancestors-or-self of the state root's high-water mark
  const hwmLine = (sectionOf(stateRoot.content, "Reconciliation") ?? "").split("\n").find((l) => /high_water_mark:/.test(l)) ?? "";
  const hwm = (hwmLine.split("high_water_mark:")[1] ?? "").split(/[\s,]+/).map((s) => s.replace(/`/g, "")).filter((s) => /^[a-z]+-[a-z]+-\d{4}$/.test(s));
  const folded = new Set<string>();
  const stack = hwm.map((s) => bySlug.get(s)?.node_id).filter(Boolean) as string[];
  while (stack.length) {
    const id = stack.pop()!;
    if (folded.has(id)) continue;
    folded.add(id);
    stack.push(...(hid.get(id)?.parent_ids ?? []));
  }

  const tmpDir = join(fw.repo, ".governor", "migrate-tmp");
  await mkdir(tmpDir, { recursive: true });
  let fileN = 0;
  const tmp = async (text: string) => {
    const p = join(tmpDir, `${fileN++ % 64}.tmp`);
    await writeFile(p, text);
    return p;
  };

  await withLock(fw.repo, "write", async () => {
    let ops = 0,
      part = 0;
    const t0 = Date.now();
    const secs = () => Math.round((Date.now() - t0) / 1000);
    const commit = async (done = false) => {
      if (!ops) return;
      await fw.call("repo:commit", "--message", done ? "governor migrate: done" : `governor migrate: part ${++part}`);
      ops = 0;
    };
    const call = async (...a: string[]) => {
      const r = await fw.call(...a);
      ops++;
      return r;
    };
    const create = async (v: { title: string; slug: string; summary?: string; content: string }) =>
      (await call("repo:node:create", "--values-file", await tmp(JSON.stringify({ title: v.title, slug_name: v.slug, summary: v.summary || null, content: v.content, origin_host: "governor", external_transcript_ref: null })))).node_id as string;

    const rootContent = `${recordRoot.content.trim()}\n\n## Migrated\n\nFrom Hypergraph roots \`${recordRoot.slug_name}\` (record) and \`${stateRoot.slug_name}\` (state)${planRoot ? ` and \`${planRoot.slug_name}\` (plan)` : ""}, ${new Date().toISOString().slice(0, 10)}.\n`;
    const root = await create({ title: String(config.project ?? recordRoot.title.replace(/ — record$/, "")), slug: recordRoot.slug_name, content: rootContent });
    const tags: Record<string, string> = {};
    for (const name of ALL_TAGS) {
      const st = TAG_STYLE[name];
      tags[name] = (await call("repo:tag:define", root, "--definition-file", await tmp(JSON.stringify({ name, bg_color: st.bg, text_color: st.fg, one_only: name === ROOT_TAG, track_history: name === ROOT_TAG })))).tag_id;
    }
    await call("repo:node-tag:assign", root, root, tags[ROOT_TAG]);
    const ids = new Map<string, string>([[recordRoot.node_id, root], [stateRoot.node_id, root]]);
    const total = all.length - 2;
    let made = 0;

    const place = async (h: HNode, kind: "record" | "state" | "plan") => {
      let content = h.content,
        status: string | null = null;
      if (kind === "record") content = recordBody(h);
      else if (h !== planRoot) [status, content] = claimBody(h.content);
      const id = await create({ title: h.title, slug: h.slug_name, summary: h.summary, content });
      ids.set(h.node_id, id);
      const parents = [...new Set(h.parent_ids.map((p) => ids.get(p)).filter(Boolean) as string[])];
      for (const p of parents.length ? parents : [root]) await call("repo:lineage:add", p, id);
      await call("repo:containment:assign", root, id);
      await call("repo:node-tag:assign", root, id, tags[kind]);
      if (status && (STATUSES as readonly string[]).includes(status)) await call("repo:node-tag:assign", root, id, tags[status]);
      if (kind === "record" && folded.has(h.node_id)) await call("repo:node-tag:assign", root, id, tags[FOLDED]);
      if (++made % 100 === 0) log(`migrate   ${made}/${total} nodes (${secs()}s, ${fw.calls} calls)`);
      if (ops >= BATCH) await commit();
    };
    // parents before children inside each graph
    const ordered = (nodes: HNode[], skip: HNode[]) => {
      const done = new Set(skip.map((n) => n.node_id));
      const out: HNode[] = [];
      const visit = (n: HNode) => {
        if (done.has(n.node_id)) return;
        done.add(n.node_id);
        for (const p of n.parent_ids) if (hid.has(p) && kindOf.get(p) === kindOf.get(n.node_id)) visit(hid.get(p)!);
        out.push(n);
      };
      nodes.forEach(visit);
      return out;
    };
    for (const h of ordered(state, [stateRoot])) await place(h, "state");
    for (const h of ordered(plan, [])) await place(h, "plan");
    for (const h of ordered(record, [recordRoot])) await place(h, "record");
    await commit();
    
    await commit();
    const s = await snapshot(fw, { cache: false });
    const impacts = s.edges.filter((e) => e.id.startsWith("impact:")).length;
    const cites = s.edges.length - impacts;
    const unresolved = s.dangling.length;
    log(`migrate   done: ${made + 1} nodes, ${impacts} impact edges, ${cites} citation edges, ${folded.size} folded, ${unresolved} unresolved references (${secs()}s, ${fw.calls} calls)`);
  });
  await rm(tmpDir, { recursive: true, force: true });
}
