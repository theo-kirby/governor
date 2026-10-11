// End to end against the real `flywheel` CLI (skipped without one that can open local
// repositories: Node ^24.15 || >=25.7).
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const BIN = new URL("../bin/governor.mjs", import.meta.url).pathname;
const [major, minor] = process.versions.node.split(".").map(Number);
let available = (major === 24 && minor >= 15) || (major === 25 && minor >= 7) || major > 25;
try {
  execFileSync("flywheel", ["--version"]);
} catch {
  available = false;
}

const BODY = "## What\n\nw\n\n## Why\n\ny\n\n## Method\n\nm\n\n## Result\n\nr\n";

function project() {
  const dir = mkdtempSync(join(tmpdir(), "governor-it-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("flywheel", ["repo:init", "--format=json"], { cwd: dir });
  writeFileSync(join(dir, "body.md"), BODY);
  return dir;
}
async function gov(cwd: string, ...args: string[]) {
  try {
    const { stdout } = await run("node", [BIN, ...args], { cwd });
    return { code: 0, out: stdout };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { code: x.code, out: x.stdout + x.stderr };
  }
}
const slugOf = (out: string) => out.trim().split(/\s+/)[0];

test("init → record → fold → check → render, end to end", { skip: !available, timeout: 300_000 }, async () => {
  const dir = project();
  assert.equal((await gov(dir, "init", "--title", "IT")).code, 0);
  const r1 = await gov(dir, "record", "--title", "first", "--body", "body.md", "--parent", "root", "--new", "engine: exists");
  assert.equal(r1.code, 0, r1.out);
  const plan = { claims: [{ new: "engine", parent: "root", title: "Engine", status: "working", current: `- exists [rec: ${slugOf(r1.out)}]`, cites: [slugOf(r1.out)] }], folded: [slugOf(r1.out)] };
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
  const f = await gov(dir, "fold", "--apply", "plan.json");
  assert.equal(f.code, 0, f.out);
  const engine = f.out.match(/engine → ([a-z]+-[a-z]+-\d{4})/)![1];
  const r2 = await gov(dir, "record", "--title", "second", "--body", "body.md", "--parent", slugOf(r1.out), "--impact", `${engine}: faster now`);
  assert.equal(r2.code, 0, r2.out);
  const c = await gov(dir, "check");
  assert.equal(c.code, 0, c.out);
  const state = (await gov(dir, "render")).out;
  assert.match(state, /\[working\] \*\*Engine\*\*/);
  assert.match(state, /Unfolded records \(1\)/);
  const tail = (await gov(dir, "fold")).out;
  assert.match(tail, new RegExp(`→ \`${engine}\`: faster now`));
});

test("a record with no declared impact, or a bad parent, writes nothing", { skip: !available, timeout: 120_000 }, async () => {
  const dir = project();
  await gov(dir, "init", "--title", "IT");
  const bad = await gov(dir, "record", "--title", "x", "--body", "body.md", "--parent", "root");
  assert.equal(bad.code, 2);
  assert.match(bad.out, /declare the record's state impact/);
  const bad2 = await gov(dir, "record", "--title", "x", "--body", "body.md", "--parent", "nope-nope-0000", "--none", "n");
  assert.equal(bad2.code, 2);
  assert.match((await gov(dir, "render")).out, /Unfolded records \(0\)/);
});

test("concurrent writers each get their own commit", { skip: !available, timeout: 300_000 }, async () => {
  const dir = project();
  await gov(dir, "init", "--title", "IT");
  const rs = await Promise.all([1, 2, 3].map((i) => gov(dir, "record", "--title", `w${i}`, "--body", "body.md", "--parent", "root", "--none", "parallel")));
  for (const r of rs) assert.equal(r.code, 0, r.out);
  const log = JSON.parse(execFileSync("flywheel", ["repo:log", "--format=json"], { cwd: dir }).toString());
  const msgs = log.commits.map((c: { message: string }) => c.message);
  for (const i of [1, 2, 3]) assert.ok(msgs.includes(`governor record: w${i}`), msgs.join(" | "));
});

test("staged work governor did not leave is refused, not swept into a commit", { skip: !available, timeout: 120_000 }, async () => {
  const dir = project();
  await gov(dir, "init", "--title", "IT");
  execFileSync("flywheel", ["repo:node:create", "--title", "foreign", "--format=json"], { cwd: dir });
  const r = await gov(dir, "record", "--title", "x", "--body", "body.md", "--parent", "root", "--none", "n");
  assert.equal(r.code, 2);
  assert.match(r.out, /did not stage/);
});
