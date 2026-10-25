import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HubCanvas, type HubColours } from "./HubCanvas";
import { kindOf } from "./hub-model";
import { FlywheelCanvas } from "./FlywheelCanvas";
import { parseReportGraph } from "../shared/report";
import type { GraphEdge, GraphNode } from "../shared/types";
import "./report.css";

// A deliberately separate entry point: no fetch, repository selection, storage,
// demo fallback or messages from the embedding page.
const root = document.getElementById("root")!;

// The hub graph and its tools. The names button (or N) names every node that has room.
function Report({ nodes, edges, hub, light }: { nodes: GraphNode[]; edges: GraphEdge[]; hub: boolean; light: boolean }) {
  const [names, setNames] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "n" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) setNames((v) => !v);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const theme = light ? "light" as const : "dark" as const;
  // The embedding page may set its own colours before this script runs: window.GRAPH_THEME = {light, dark}.
  const colours = (window as { GRAPH_THEME?: Partial<Record<typeof theme, HubColours>> }).GRAPH_THEME?.[theme];
  return <>
    {hub
      ? <HubCanvas nodes={nodes} edges={edges} label="Committed research memory" theme={theme} colours={colours} names={names} />
      : <FlywheelCanvas nodes={nodes} edges={edges} label="Committed research memory" />}
    <div className="report-tools">
      <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", {key:"f"}))}>Fit graph</button>
      {hub && <button aria-pressed={names} onClick={() => setNames((v) => !v)}>{names ? "Hide names" : "Show names"}</button>}
      <details><summary>Node titles ({nodes.length})</summary><ul>{nodes.map(n => <li key={n.id}>{n.title}</li>)}</ul></details>
    </div>
  </>;
}

try {
  const graph = parseReportGraph(JSON.parse(document.getElementById("flywheel-snapshot")!.textContent!));
  // Use the complete replica view for untyped nodes and plans.
  const hub = graph.nodes.some(n => kindOf(n) === "root") && graph.nodes.every(n => kindOf(n) !== "other" && kindOf(n) !== "plan");
  root.dataset.viewer = "governor";
  root.dataset.layout = hub ? "hub" : "replica";
  // The embedding page may ask for the light palette (the hub layout only; the replica stays dark).
  const light = document.documentElement.dataset.theme === "light";
  if (light && hub) document.documentElement.classList.add("report-light");
  createRoot(root).render(graph.nodes.length
    ? <Report nodes={graph.nodes} edges={graph.edges} hub={hub} light={light} />
    : <p className="report-message">This graph has no committed nodes yet.</p>);
} catch {
  root.textContent = "Graph unavailable. Reload the report to try again.";
}
