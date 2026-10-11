import { FlywheelAdapter, resolveRepo, runCli } from "./adapter";
import { Flywheel } from "../lib/flywheel";
import { snapshot as governorSnapshot } from "../lib/snapshot";
import { toViewer } from "./governor";
import { parseReportGraph } from "../shared/report";

try {
  if (process.argv.length !== 3) throw new Error("Expected one repository root");
  const repo = await resolveRepo(process.argv[2]);
  const before = await runCli("repo:status", repo) as {heads:{workspace:string|null}};
  // Recognize governed graphs without initializing, migrating or writing caches.
  const governed = await governorSnapshot(new Flywheel(repo), {cache:false});
  const snapshot = governed.root ? toViewer(repo, governed) : await new FlywheelAdapter().snapshot(repo, false);
  const after = await runCli("repo:status", repo) as {heads:{workspace:string|null}};
  if (before.heads.workspace !== snapshot.head || after.heads.workspace !== snapshot.head) throw new Error("Graph changed during read");
  const graph = parseReportGraph({...snapshot, schemaVersion: 1});
  const json = JSON.stringify(graph);
  if (Buffer.byteLength(json) > 1000000) throw new Error("Report graph too large");
  process.stdout.write(json);
} catch {
  process.stderr.write("Unable to read a consistent committed Governor report graph.\n");
  process.exitCode = 1;
}
