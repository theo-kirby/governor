#!/usr/bin/env node
// Runs the TypeScript CLI through tsx, so the package ships its sources unbuilt.
//
// Flywheel local repositories need Node ^24.15 || >=25.7. When the `node` on PATH is
// older (a project toolchain such as pixi often ships its own), re-run under the first
// supported one found: $GOVERNOR_NODE, then the usual system locations.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const supported = (v) => {
  const [major, minor] = v.replace(/^v/, "").split(".").map(Number);
  return (major === 24 && minor >= 15) || (major === 25 && minor >= 7) || major > 25;
};

if (!supported(process.version) && !process.env.GOVERNOR_REEXEC) {
  const candidates = [process.env.GOVERNOR_NODE, "/usr/bin/node", "/usr/local/bin/node", "/opt/homebrew/bin/node"].filter(Boolean);
  for (const node of candidates) {
    if (!existsSync(node)) continue;
    const version = spawnSync(node, ["--version"], { encoding: "utf8" }).stdout?.trim() ?? "";
    if (!supported(version)) continue;
    const r = spawnSync(node, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, GOVERNOR_REEXEC: "1" } });
    process.exit(r.status ?? 1);
  }
}

const { register } = await import("tsx/esm/api");
register();
await import("../cli/main.ts");
