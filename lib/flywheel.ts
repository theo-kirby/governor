// The one door to Flywheel. Every governor read and write goes through `Flywheel.call`,
// which runs the installed `flywheel` CLI's own entry point in-process when it can
// (~115 ms a call, against ~300 ms+ to spawn one) and falls back to spawning it.
// Calls are serialized: a repository has one staging area, and the in-process path
// captures process.stdout, which is not re-entrant.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export class FlywheelError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

type Runner = (argv: string[]) => Promise<string>;

let inProcess: Promise<Runner | null> | null = null;

async function loadInProcess(): Promise<Runner | null> {
  if (process.env.GOVERNOR_FLYWHEEL_SPAWN === "1") return null;
  try {
    const { stdout } = await run("sh", ["-c", "command -v flywheel"]);
    const bin = await realpath(stdout.trim());
    const entry = join(dirname(bin), "..", "src", "unified-cli.mjs");
    await stat(entry);
    const mod = await import(pathToFileURL(entry).href);
    if (typeof mod.runUnifiedCli !== "function") return null;
    return async (argv) => {
      let out = "";
      let err = "";
      const write = process.stdout.write.bind(process.stdout);
      const ewrite = process.stderr.write.bind(process.stderr);
      process.stdout.write = ((chunk: string | Uint8Array) => {
        out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        err += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        return true;
      }) as typeof process.stderr.write;
      const before = process.exitCode;
      process.exitCode = 0;
      try {
        await mod.runUnifiedCli(argv);
      } catch (e) {
        err += e instanceof Error ? e.message : String(e);
        process.exitCode = process.exitCode || 1;
      } finally {
        process.stdout.write = write;
        process.stderr.write = ewrite;
      }
      const code = process.exitCode;
      process.exitCode = before;
      if (code) throw failure(out || err);
      return out;
    };
  } catch {
    return null;
  }
}

function failure(raw: string): FlywheelError {
  try {
    const e = JSON.parse(raw).error;
    return new FlywheelError(e.message ?? raw, e.code, e.next_action);
  } catch {
    return new FlywheelError(raw.trim() || "flywheel failed");
  }
}

async function spawnRunner(argv: string[]): Promise<string> {
  try {
    const { stdout } = await run("flywheel", argv, { maxBuffer: 512 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; code?: string };
    if (x.code === "ENOENT")
      throw new FlywheelError("the `flywheel` CLI is not on PATH (npm install -g @paradigma-inc/flywheel)");
    throw failure(x.stdout || x.stderr || String(e));
  }
}

export class Flywheel {
  private queue: Promise<unknown> = Promise.resolve();
  calls = 0;
  constructor(readonly repo: string) {}

  /** Run one `flywheel` command against this repository; returns its JSON. */
  call<T = any>(...argv: string[]): Promise<T> {
    const next = this.queue.then(async () => {
      inProcess ??= loadInProcess();
      const runner = (await inProcess) ?? spawnRunner;
      const out = await runner([...argv, "--repo", this.repo, "--format=json"]);
      this.calls++;
      return (out.trim() ? JSON.parse(out) : {}) as T;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async head(): Promise<string | null> {
    return (await this.call("repo:status")).heads?.workspace ?? null;
  }

  async staged(): Promise<{ digest: string; count: number }> {
    const s = (await this.call("repo:status")).staging ?? {};
    return { digest: s.digest, count: s.operation_count ?? 0 };
  }
}

export async function cliVersion(): Promise<string> {
  const { stdout } = await run("flywheel", ["--version"]);
  return stdout.trim();
}

/**
 * The main checkout for `start`: itself unless it is a git worktree. The repository
 * and governor's lock live there, so every worktree writes into one graph.
 */
export async function mainCheckout(start: string): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", start, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const common = stdout.trim();
    if (common.endsWith("/.git")) return dirname(common);
  } catch {
    /* not a git checkout */
  }
  return start;
}

/** Walk up from `start` to the directory holding `.flywheel/`. */
export async function findRepo(start: string): Promise<string | null> {
  let dir = await mainCheckout(start);
  for (;;) {
    try {
      await stat(join(dir, ".flywheel", "db.sqlite"));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  }
}

/**
 * An exclusive lock in `<repo>/.governor/<name>.lock` (O_EXCL create, pid inside, stale
 * locks from dead processes reclaimed). Held across a stage-and-commit.
 */
export async function withLock<T>(repo: string, name: string, fn: () => Promise<T>, timeoutMs = 600_000): Promise<T> {
  const dir = join(repo, ".governor");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.lock`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fh = await open(path, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number((await readFile(path, "utf8").catch(() => "")).trim());
      let alive = false;
      if (pid)
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      if (!alive) {
        await rm(path, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new FlywheelError(`governor ${name} lock held by pid ${pid} (${path})`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(path, { force: true });
  }
}
