import { createRoot } from "react-dom/client";
import { HubCanvas } from "./HubCanvas";
import { kindOf } from "./hub-model";
import { FlywheelCanvas } from "./FlywheelCanvas";
import { parseReportGraph } from "../shared/report";
import "./report.css";

// A deliberately separate entry point: no fetch, repository selection, storage,
// demo fallback or messages from the embedding page.
const root = document.getElementById("root")!;
try {
  const graph = parseReportGraph(JSON.parse(document.getElementById("flywheel-snapshot")!.textContent!));
  // Use the complete replica view for untyped nodes and plans.
  const hub = graph.nodes.some(n => kindOf(n) === "root") && graph.nodes.every(n => kindOf(n) !== "other" && kindOf(n) !== "plan");
  const Canvas = hub ? HubCanvas : FlywheelCanvas;
  root.dataset.viewer = "governor";
  root.dataset.layout = hub ? "hub" : "replica";
  createRoot(root).render(graph.nodes.length ? <>
    <Canvas nodes={graph.nodes} edges={graph.edges} label="Committed research memory" />
    <div className="report-tools">
      <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", {key:"f"}))}>Fit graph</button>
      <details><summary>Node titles ({graph.nodes.length})</summary><ul>{graph.nodes.map(n => <li key={n.id}>{n.title}</li>)}</ul></details>
    </div>
  </> : <p className="report-message">This graph has no committed nodes yet.</p>);
} catch {
  root.textContent = "Graph unavailable. Reload the report to try again.";
}
