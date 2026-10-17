// governor — the CLI. `governor help` lists the commands.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { promisify, parseArgs } from "node:util";
import { check } from "../lib/check";
import { cliVersion, findRepo, Flywheel, FlywheelError } from "../lib/flywheel";
import { orient, renderState } from "../lib/render";
import { snapshot, tail } from "../lib/snapshot";
import { fold, GovernorError, init, record, type FoldPlan } from "../lib/write";

const run = promisify(execFile);
const HELP = `governor — a record/state research graph on a Flywheel repository

  governor init --title T [--body F]       create the root and the tag vocabulary
  governor record --title T --body F --parent SLUG...
                  (--impact "SLUG: delta"... | --new "name: delta"... | --none "reason")
  governor fold                            print the tail and its declared impacts
  governor fold --apply PLAN.json          write claims, statuses, citations; tag records folded
  governor check [--threshold N]           enforce the rules (exit 1 on a violation)
  governor render [-o FILE]                the state snapshot as markdown
  governor head                            the repository head (cheap; for cache keys)
  governor orient                          frontier + tail impacts + recent records
  governor snapshot                        the whole graph as JSON
  governor viz [--port N]                  serve the hub viewer for this repository
  governor skills install [--user|--target DIR]   copy the skills into .claude/skills

--json makes record, fold --apply, check and head print one JSON object.

Options: --repo DIR (default: the .flywheel repository above the current directory,
resolved through git worktrees to the main checkout).`;

async function repoFrom(arg?: string): Promise<Flywheel> {
  const dir = arg ? resolvePath(arg) : await findRepo(process.cwd());
  if (!dir) throw new GovernorError("no Flywheel repository here — `flywheel repo:init` at the project root, then `governor init`");
  return new Flywheel(dir);
}

async function gitContext(at: string) {
  const g = async (...a: string[]) => (await run("git", a).catch(() => ({ stdout: "" }))).stdout.trim();
  const commit = await g("rev-parse", "HEAD");
  if (!commit) return { at };
  return { at, repo: (await g("config", "--get", "remote.origin.url")) || undefined, branch: (await g("rev-parse", "--abbrev-ref", "HEAD")) || undefined, commit };
}

function pairs(values: string[] | undefined, what: string): { key: string; delta: string }[] {
  return (values ?? []).map((v) => {
    const m = v.match(/^\s*([^:\s]+)\s*:\s*(.+)$/s);
    if (!m) throw new GovernorError(`${what} must look like "<name>: <delta>" (got ${JSON.stringify(v)})`);
    return { key: m[1], delta: m[2].trim() };
  });
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }
  const { values } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      summary: { type: "string" },
      parent: { type: "string", multiple: true },
      impact: { type: "string", multiple: true },
      new: { type: "string", multiple: true },
      none: { type: "string" },
      apply: { type: "string" },
      threshold: { type: "string" },
      output: { type: "string", short: "o" },
      port: { type: "string" },
      json: { type: "boolean" },
      view: { type: "string" },
      user: { type: "boolean" },
      target: { type: "string" },
    },
  });
  switch (command) {
    case "init": {
      const fw = await repoFrom(values.repo);
      const body = values.body ? await readFile(values.body, "utf8") : "";
      const s = await init(fw, values.title ?? "Project", body);
      console.log(`root ${s.nodes[s.root!].slug} with ${Object.keys(s.tagIds).length} tags`);
      return 0;
    }
    case "record": {
      const fw = await repoFrom(values.repo);
      if (!values.body) throw new GovernorError("--body FILE is required (`-` reads stdin)");
      const body = values.body === "-" ? readFileSync(0, "utf8") : await readFile(values.body, "utf8");
      const r = await record(fw, {
        title: values.title ?? "",
        body,
        summary: values.summary,
        parents: values.parent ?? [],
        impacts: pairs(values.impact, "--impact").map((p) => ({ target: p.key, delta: p.delta })),
        news: pairs(values.new, "--new").map((p) => ({ name: p.key, delta: p.delta })),
        none: values.none ?? null,
        ctx: await gitContext(new Date().toISOString().replace(/\.\d+Z$/, "Z")),
      });
      if (values.json) console.log(JSON.stringify({ slug: r.slug, head: r.head }));
      else console.log(`${r.slug}  (record)  committed ${r.head?.slice(0, 19) ?? ""}`);
      return 0;
    }
    case "fold": {
      const fw = await repoFrom(values.repo);
      if (values.apply) {
        const plan = JSON.parse(await readFile(values.apply, "utf8")) as FoldPlan;
        const r = await fold(fw, plan);
        const made = Object.entries(r.created).map(([k, v]) => `${k} → ${v}`).join(", ");
        if (values.json) console.log(JSON.stringify({ head: r.head, created: r.created, folded: plan.folded.length, claims: plan.claims.length }));
        else console.log(`folded ${plan.folded.length} record(s) into ${plan.claims.length} claim(s)${made ? `; new: ${made}` : ""}`);
        return 0;
      }
      const s = await snapshot(fw);
      const t = tail(s);
      if (values.json) console.log(JSON.stringify(t.map((n) => ({ slug: n.slug, title: n.title, content: n.content })), null, 1));
      else console.log(orient(s).split("## Most recent records")[0].trim() || `tail: ${t.length}`);
      return 0;
    }
    case "check": {
      const fw = await repoFrom(values.repo);
      const s = await snapshot(fw);
      const findings = check(s, { foldThreshold: values.threshold ? Number(values.threshold) : undefined, legacyBefore: legacyBefore(s) });
      const n = findings.filter((f) => f.level === "violation").length;
      if (values.json) {
        console.log(JSON.stringify({ ok: !n, violations: n, warnings: findings.length - n, findings, head: s.head }));
        return n ? 1 : 0;
      }
      for (const f of findings) console.log(`${f.level === "violation" ? "VIOLATION" : "warning  "} ${f.rule} ${f.node ? `${f.node}: ` : ""}${f.message}`);
      console.log(`\ncheck: ${n} violation(s), ${findings.length - n} warning(s)`);
      return n ? 1 : 0;
    }
    case "render": {
      const fw = await repoFrom(values.repo);
      if (values.view && values.view !== "state" && values.view !== "plan") throw new GovernorError("--view is state or plan");
      const text = renderState(await snapshot(fw), { view: values.view as "state" | "plan" | undefined });
      if (values.output) await writeFile(values.output, text);
      else process.stdout.write(text);
      return 0;
    }
    case "orient": {
      const fw = await repoFrom(values.repo);
      process.stdout.write(orient(await snapshot(fw)));
      return 0;
    }
    case "head": {
      const fw = await repoFrom(values.repo);
      const st = await fw.call("repo:status");
      const head: string | null = st.heads?.workspace ?? null;
      console.log(values.json ? JSON.stringify({ head, repository: st.repository_id ?? null }) : head ?? "");
      return 0;
    }
    case "snapshot": {
      const fw = await repoFrom(values.repo);
      console.log(JSON.stringify(await snapshot(fw)));
      return 0;
    }
    case "viz": {
      const fw = await repoFrom(values.repo);
      process.env.FLYWHEEL_REPO = fw.repo;
      process.env.NODE_ENV = "production";
      process.env.GOVERNOR_DEFAULT_PARAMS ||= "layout=hub";
      if (values.port) process.env.PORT = values.port;
      const here = new URL("..", import.meta.url).pathname;
      process.chdir(here);
      await import("../server/index");
      return -1; // keep serving
    }
    case "skills": {
      if (rest[0] !== "install") throw new GovernorError("governor skills install [--user | --target DIR]");
      const { cp, readdir } = await import("node:fs/promises");
      const { homedir } = await import("node:os");
      const src = new URL("../skills/", import.meta.url).pathname;
      const dest = values.target ? resolvePath(values.target) : values.user ? `${homedir()}/.claude/skills` : resolvePath(".claude/skills");
      for (const name of await readdir(src)) {
        await cp(`${src}${name}`, `${dest}/${name}`, { recursive: true, force: true });
        console.log(`installed ${name} → ${dest}/${name}`);
      }
      return 0;
    }
    case "version":
    case "--version":
      console.log(`governor 0.1.0 (flywheel ${await cliVersion().catch(() => "?")})`);
      return 0;
  }
  throw new GovernorError(`unknown command \`${command}\` — governor help`);
}

/** Records written by an import (`governor migrate` commits) predate the impact lines G3 asks for. */
function legacyBefore(s: Awaited<ReturnType<typeof snapshot>>): number | undefined {
  let marker = -1;
  s.commits.forEach((c, i) => {
    if (c.message.startsWith("governor migrate")) marker = i;
  });
  if (marker < 0) return undefined;
  const ids = new Set(s.commits.slice(0, marker + 1).flatMap((c) => c.nodes));
  return Math.max(-1, ...[...ids].map((id) => s.nodes[id]?.seq ?? -1)) + 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (e) => {
    if (e instanceof GovernorError || e instanceof FlywheelError) {
      console.error(`error: ${e.message}${e instanceof FlywheelError && e.hint ? `\n  ${e.hint}` : ""}`);
      process.exitCode = 2;
    } else {
      console.error(e);
      process.exitCode = 3;
    }
  },
);
