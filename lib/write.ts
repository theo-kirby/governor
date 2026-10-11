// Every governor write: stage under the write lock, refuse to stage over work governor did
// not leave, commit once with a message that says which role wrote it, and discard our
// own half-staged batch if anything fails.
import { randomInt } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Flywheel, withLock } from "./flywheel";
import {
  ALL_TAGS,
  claimContent,
  FOLD_PREFIX,
  FOLDED,
  impactContent,
  KEBAB_RE,
  RECORD_PREFIX,
  recordContent,
  RECORD_SECTIONS,
  GENERATED_SECTIONS,
  ROOT_TAG,
  SLUG_RE,
  STATUSES,
  TAG_STYLE,
  type Kind,
  type RecordedContext,
  type Status,
} from "./model";
import { bySlug, resolve, snapshot, tail, type GraphSnapshot, type GNode } from "./snapshot";

export class GovernorError extends Error {}

const ADJ = "amber autumn bold brave bright calm civic cold cool crisp dawn deep dry dusty eager early fair fast fond frosty gentle golden grand green hidden humble keen kind late lawful little lone loud lucky merry misty modest noble odd old open pale proud quiet rapid rich rough royal rustic sandy scarlet sharp shy silent silver sleek solemn spare staid steady stormy sunny swift tall terse tidy tiny true twilight vast warm wild winter wise young zesty".split(" ");
const NOUN = "acorn anchor arrow ash aspen basin bay birch bloom brook canyon cedar chart cliff cloud coast comet crane creek crest dawn delta dune ember fern field finch forest fountain fox gate glade grove harbor harvest hawk haven heron hill hollow horizon ivy key lake lantern leaf marsh meadow mesa mist moon mountain oak orchard otter owl peak pine pond quill rain reef ridge river sail shade shore sky spark spring star stone summit sun thistle tide tower trail tree valley vale walrus wave willow wolf wren".split(" ");

export function mintSlug(taken: Set<string>): string {
  for (let i = 0; i < 10000; i++) {
    const slug = `${ADJ[randomInt(ADJ.length)]}-${NOUN[randomInt(NOUN.length)]}-${String(randomInt(10000)).padStart(4, "0")}`;
    if (!taken.has(slug) && SLUG_RE.test(slug)) return slug;
  }
  throw new GovernorError("could not mint a free slug");
}

/** One locked stage-and-commit. `stage` gets a scratch dir for value files. */
export async function transaction<T>(
  fw: Flywheel,
  message: string,
  stage: (tmp: (name: string, text: string) => Promise<string>) => Promise<T>,
): Promise<{ result: T; head: string | null }> {
  return withLock(fw.repo, "write", async () => {
    const before = await fw.staged();
    if (before.count)
      throw new GovernorError(
        `the Flywheel repository has ${before.count} staged operation(s) governor did not stage — ` +
          "commit or discard them (flywheel repo:commit / repo:staging:discard) first",
      );
    const dir = await mkdtemp(join(tmpdir(), "governor-"));
    let n = 0;
    const tmp = async (name: string, text: string) => {
      const p = join(dir, `${n++}-${name}`);
      await writeFile(p, text);
      return p;
    };
    try {
      const result = await stage(tmp);
      const staged = await fw.staged();
      if (!staged.count) return { result, head: await fw.head() };
      const made = await fw.call("repo:commit", "--message", message);
      return { result, head: made.head ?? made.commit_id ?? null };
    } catch (e) {
      const staged = await fw.staged().catch(() => ({ count: 0, digest: "" }));
      if (staged.count)
        await fw.call("repo:staging:discard", "--staging-digest", staged.digest, "--confirm").catch(() => {});
      throw e;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

async function createNode(
  fw: Flywheel,
  tmp: (name: string, text: string) => Promise<string>,
  v: { title: string; slug: string; summary?: string; content: string },
): Promise<string> {
  const file = await tmp("node.json", JSON.stringify({
    title: v.title,
    slug_name: v.slug,
    summary: v.summary || null,
    content: v.content,
    origin_host: "governor",
    external_transcript_ref: null,
  }));
  return (await fw.call("repo:node:create", "--values-file", file)).node_id;
}

function tagId(s: GraphSnapshot, name: string): string {
  const id = Object.entries(s.tagIds).find(([, n]) => n === name)?.[0];
  if (!id) throw new GovernorError(`tag \`${name}\` is not defined — run \`governor init\``);
  return id;
}

// ------------------------------------------------------------------ init

export async function init(fw: Flywheel, title: string, content: string): Promise<GraphSnapshot> {
  const s = await snapshot(fw, { cache: false });
  if (s.root) throw new GovernorError(`this repository already has a governor root (${s.nodes[s.root].slug || s.root})`);
  await transaction(fw, "governor init", async (tmp) => {
    const root = await createNode(fw, tmp, { title, slug: mintSlug(new Set(Object.values(s.nodes).map((n) => n.slug))), content });
    const ids: Record<string, string> = {};
    for (const name of ALL_TAGS) {
      const style = TAG_STYLE[name];
      const def = await tmp("tag.json", JSON.stringify({ name, bg_color: style.bg, text_color: style.fg, one_only: name === ROOT_TAG, track_history: name === ROOT_TAG }));
      ids[name] = (await fw.call("repo:tag:define", root, "--definition-file", def)).tag_id;
    }
    await fw.call("repo:node-tag:assign", root, root, ids[ROOT_TAG]);
  });
  return snapshot(fw, { cache: false });
}

// ---------------------------------------------------------------- record

export type RecordInput = {
  title: string;
  body: string;
  parents: string[];
  impacts: { target: string; delta: string }[];
  news: { name: string; delta: string }[];
  none: string | null;
  ctx: RecordedContext;
  summary?: string;
};

export function validateRecord(s: GraphSnapshot, input: RecordInput): string[] {
  const problems: string[] = [];
  if (!s.root) problems.push("no governor root — run `governor init`");
  if (!input.title.trim()) problems.push("a record needs a title");
  for (const h of RECORD_SECTIONS)
    if (!new RegExp(`^${h}\\s*$`, "m").test(input.body)) problems.push(`the body needs a \`${h}\` section`);
  for (const h of GENERATED_SECTIONS)
    if (new RegExp(`^${h}\\s*$`, "m").test(input.body)) problems.push(`the body must not contain \`${h}\` — governor writes it`);
  if (!input.parents.length) problems.push("a record needs at least one causal --parent (a record slug, or `root` for a first record)");
  for (const p of input.parents) {
    const n = resolve(s, p);
    if (!n) problems.push(`parent \`${p}\` is not in the graph`);
    else if (n.kind !== "record" && n.kind !== "root") problems.push(`parent \`${p}\` is a ${n.kind} node — record parents are records (or root)`);
  }
  const declared = input.impacts.length + input.news.length;
  if (declared && input.none !== null) problems.push("pass impacts or --none, not both");
  if (!declared && input.none === null) problems.push("declare the record's state impact: --impact, --new, or --none <reason> (G3)");
  for (const i of input.impacts) {
    const n = resolve(s, i.target);
    if (!n) problems.push(`impact target \`${i.target}\` is not in the graph — use --new <name>: <delta> for a claim that does not exist yet`);
    else if (n.kind !== "state" && n.kind !== "plan") problems.push(`impact target \`${i.target}\` is a ${n.kind} node, not a claim`);
  }
  for (const n of input.news) if (!KEBAB_RE.test(n.name)) problems.push(`new claim name \`${n.name}\` is not kebab-case`);
  return problems;
}

export async function record(fw: Flywheel, input: RecordInput): Promise<{ slug: string; id: string; head: string | null }> {
  const s = await snapshot(fw);
  const problems = validateRecord(s, input);
  if (problems.length) throw new GovernorError(problems.map((p) => `- ${p}`).join("\n"));
  const slugs = bySlug(s);
  const slug = mintSlug(new Set(slugs.keys()));
  const labels = [
    ...input.impacts.map((i) => ({ label: resolve(s, i.target)!.slug || i.target, delta: i.delta })),
    ...input.news.map((n) => ({ label: `NEW ${n.name}`, delta: n.delta })),
  ];
  const content = recordContent(input.body, labels, input.none, input.ctx);
  const { result, head } = await transaction(fw, `${RECORD_PREFIX}: ${input.title.slice(0, 160)}`, async (tmp) => {
    const id = await createNode(fw, tmp, { title: input.title, slug, summary: input.summary, content });
    for (const p of [...new Set(input.parents.map((p) => resolve(s, p)!.id))]) await fw.call("repo:lineage:add", p, id);
    await fw.call("repo:containment:assign", s.root!, id);
    await fw.call("repo:node-tag:assign", s.root!, id, tagId(s, "record"));
    const grouped = new Map<string, string[]>();
    for (const i of input.impacts) {
      const t = resolve(s, i.target)!.id;
      grouped.set(t, [...(grouped.get(t) ?? []), i.delta]);
    }
    for (const [t, deltas] of grouped)
      await fw.call("repo:edge:add", s.root!, id, t, "--content-file", await tmp("edge.txt", impactContent(deltas)));
    // new claims have no node to point at yet: they live as `NEW <name> — <delta>` lines
    // in the generated `## State Impact`, which the fold reads (docs/CONVENTIONS.md)
    return id;
  });
  return { slug, id: result, head };
}

// ------------------------------------------------------------------ fold

export type ClaimChange = {
  /** an existing claim's slug, or omit and give `new` */
  slug?: string;
  new?: string;
  kind?: Extract<Kind, "state" | "plan">;
  /** for new claims: parent claim slug or `root` */
  parent?: string;
  title?: string;
  status: Status;
  current: string;
  negative?: string;
  cites: string[];
};
export type FoldPlan = { claims: ClaimChange[]; folded: string[]; view?: Extract<Kind, "state" | "plan"> };

export function validateFold(s: GraphSnapshot, plan: FoldPlan): string[] {
  const problems: string[] = [];
  const tailIds = new Set(tail(s).map((n) => n.id));
  for (const r of plan.folded) {
    const n = resolve(s, r);
    if (!n) problems.push(`folded record \`${r}\` is not in the graph`);
    else if (n.kind !== "record") problems.push(`\`${r}\` is not a record`);
    else if (!tailIds.has(n.id)) problems.push(`\`${r}\` is already folded`);
  }
  for (const c of plan.claims) {
    const label = c.slug ?? c.new ?? "?";
    if (!!c.slug === !!c.new) problems.push(`claim ${label}: give exactly one of slug (existing) or new (name)`);
    if (c.slug) {
      const n = resolve(s, c.slug);
      if (!n) problems.push(`claim \`${c.slug}\` is not in the graph`);
      else if (n.kind !== "state" && n.kind !== "plan") problems.push(`\`${c.slug}\` is a ${n.kind} node, not a claim`);
    }
    if (c.new) {
      if (!c.title) problems.push(`new claim ${c.new} needs a title`);
      const p = resolve(s, c.parent ?? "root");
      const newNames = new Set(plan.claims.filter((x) => x.new).map((x) => x.new));
      if (!p && !newNames.has(c.parent!)) problems.push(`new claim ${c.new}: parent \`${c.parent}\` is not in the graph`);
      else if (p && p.kind !== "root" && p.kind !== (c.kind ?? plan.view ?? "state")) problems.push(`new claim ${c.new}: parent \`${c.parent}\` is a ${p.kind} node`);
    }
    if (!(STATUSES as readonly string[]).includes(c.status)) problems.push(`claim ${label}: status \`${c.status}\` is not one of ${STATUSES.join(", ")}`);
    if (!c.cites.length && c.status !== "open") problems.push(`claim ${label}: a ${c.status} claim cites at least one record (G4)`);
    for (const r of c.cites) {
      const n = resolve(s, r);
      if (!n || n.kind !== "record") problems.push(`claim ${label}: cited \`${r}\` is not a record`);
    }
  }
  return problems;
}

export async function fold(fw: Flywheel, plan: FoldPlan): Promise<{ head: string | null; created: Record<string, string> }> {
  return withLock(fw.repo, "fold", async () => {
    const s = await snapshot(fw, { cache: false });
    const problems = validateFold(s, plan);
    if (problems.length) throw new GovernorError(problems.map((p) => `- ${p}`).join("\n"));
    const created: Record<string, string> = {};
    const taken = new Set(bySlug(s).keys());
    const edgeFrom = new Map(s.edges.map((e) => [`${e.source}>${e.target}`, e]));
    const msg = `${FOLD_PREFIX}: ${plan.folded.length} record(s), ${plan.claims.length} claim(s)`;
    const { head } = await transaction(fw, msg, async (tmp) => {
      const ids = new Map<string, string>(); // new name → id
      const pending = [...plan.claims];
      // new claims first, parents before children
      for (let guard = 0; pending.some((c) => c.new) && guard < 100; guard++)
        for (const c of pending.filter((c) => c.new && !ids.has(c.new))) {
          const parentRef = c.parent ?? "root";
          const parentId = ids.get(parentRef) ?? resolve(s, parentRef)?.id;
          if (!parentId) continue;
          const slug = mintSlug(taken);
          taken.add(slug);
          const id = await createNode(fw, tmp, { title: c.title!, slug, content: claimContent(c.current, c.negative ?? "") });
          await fw.call("repo:lineage:add", parentId, id);
          await fw.call("repo:containment:assign", s.root!, id);
          await fw.call("repo:node-tag:assign", s.root!, id, tagId(s, c.kind ?? plan.view ?? "state"));
          ids.set(c.new!, id);
          created[c.new!] = slug;
        }
      for (const c of plan.claims) {
        const node: GNode | null = c.slug ? resolve(s, c.slug) : null;
        const id = node?.id ?? ids.get(c.new!)!;
        if (node) {
          const content = claimContent(c.current, c.negative ?? "");
          if (content !== node.content)
            await fw.call("repo:node:set", id, "--field", "content", "--value-file", await tmp("content.md", content));
          if (c.title && c.title !== node.title)
            await fw.call("repo:node:set", id, "--field", "title", "--value-file", await tmp("title.txt", c.title));
        }
        const had = node?.status ?? null;
        if (had !== c.status) {
          if (had) await fw.call("repo:node-tag:remove", s.root!, id, tagId(s, had));
          await fw.call("repo:node-tag:assign", s.root!, id, tagId(s, c.status));
        }
        for (const r of new Set(c.cites)) {
          const rid = resolve(s, r)!.id;
          if (!edgeFrom.has(`${id}>${rid}`)) {
            await fw.call("repo:edge:add", s.root!, id, rid, "--content-file", await tmp("edge.txt", "cites\n"));
            edgeFrom.set(`${id}>${rid}`, { id: "", source: id, target: rid, content: "cites" });
          }
        }
      }
      const folded = tagId(s, FOLDED);
      for (const r of plan.folded) await fw.call("repo:node-tag:assign", s.root!, resolve(s, r)!.id, folded);
    });
    return { head, created };
  });
}
