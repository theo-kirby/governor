import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { HubCanvas, type HubColours } from "./HubCanvas";
import { parseSettings, type HubSettings } from "./hub-settings";
import { paletteColours } from "./hub-palettes";
import { kindOf } from "./hub-model";
import { FlywheelCanvas } from "./FlywheelCanvas";
import { parseReportGraph } from "../shared/report";
import type { GraphEdge, GraphNode, NodeDetail } from "../shared/types";
import type { LoadNode } from "./NodePanel";
import "./report.css";

// A deliberately separate entry point: no fetch, repository selection, storage,
// demo fallback or messages from the embedding page.
const root = document.getElementById("root")!;

// The hub graph and its tools. The names button (or N) names every node that has room.
function Report({ nodes, edges, hub, light, details, organic, settings }: { nodes: GraphNode[]; edges: GraphEdge[]; hub: boolean; light: boolean; details?: LoadNode; organic: boolean; settings?: HubSettings }) {
  const [names, setNames] = useState(settings?.names ?? false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "n" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) setNames((v) => !v);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const theme = light ? "light" as const : "dark" as const;
  // The embedding page may set its own colours before this script runs: window.GRAPH_THEME = {light, dark}.
  // A preset's palette comes second to them; the page's light or dark wins over the preset's theme.
  const colours = (window as { GRAPH_THEME?: Partial<Record<typeof theme, HubColours>> }).GRAPH_THEME?.[theme]
    ?? (settings ? paletteColours(settings.palette, theme) : undefined);
  const look = useMemo(() => settings && {
    layout: {
      rootGap: settings.rootGap, depthGap: settings.depthGap, stateRingGap: settings.stateRingGap,
      stateBlobSize: settings.stateBlobSize, stateBlobJoin: settings.stateBlobJoin, stateAngularGap: settings.stateAngularGap,
      stagger: settings.stagger, evidenceOutside: settings.evidenceOutside, recordGap: settings.recordGap,
      recordRingGap: settings.recordRingGap, recordAngularGap: settings.recordAngularGap, recordSpread: settings.recordSpread,
      showRecords: settings.showRecords, recordPercent: settings.recordPercent, recordPlacement: settings.recordPlacement,
      recordOrder: settings.recordOrder,
    },
    appearance: {
      recordSize: settings.recordSize, recordOpacity: settings.recordOpacity, ageColours: settings.ageColours,
      recordBlobs: settings.recordBlobs, preserveStateOutlines: settings.preserveStateOutlines,
      preserveRecordOutlines: settings.preserveRecordOutlines, stateBlobSize: settings.stateBlobSize,
      guides: settings.guides, citations: settings.citations,
    },
  }, [settings]);
  return <>
    {hub
      ? <HubCanvas nodes={nodes} edges={edges} label="Committed research memory" theme={theme} colours={colours} names={names} details={details}
          organic={settings ? settings.organic : organic} statePacking={settings?.packing} layoutOptions={look?.layout} appearance={look?.appearance} />
      : <FlywheelCanvas nodes={nodes} edges={edges} label="Committed research memory" />}
    <div className="report-tools">
      <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", {key:"f"}))}>Fit graph</button>
      {hub && <button aria-pressed={names} onClick={() => setNames((v) => !v)}>{names ? "Hide names" : "Show names"}</button>}
      <details><summary>Node titles ({nodes.length})</summary><ul>{nodes.map(n => <li key={n.id}>{n.title}</li>)}</ul></details>
    </div>
  </>;
}

// Node bodies are not part of the report snapshot, which carries topology and titles only. A page
// that means to publish them adds its own <script id="flywheel-bodies" type="application/json">:
// {"<node id>": {"content": "markdown", "summary"?, "slug"?, "refs"?: {"rec:slug": "<node id>"}}}.
// With it, clicking a node opens the detail panel.
function readBodies(nodes: GraphNode[]): LoadNode | undefined {
  const el = document.getElementById("flywheel-bodies");
  if (!el) return undefined;
  const ids = new Set(nodes.map((n) => n.id));
  const raw = JSON.parse(el.textContent!) as Record<string, Record<string, unknown>>;
  const text = (x: unknown, max: number) => (typeof x === "string" && x.length <= max ? x : undefined);
  const bodies = new Map<string, NodeDetail>();
  for (const [id, b] of Object.entries(raw)) {
    const content = text(b?.content, 50000);
    if (!ids.has(id) || content === undefined) continue;
    const refs: Record<string, string> = {};
    if (b.refs && typeof b.refs === "object")
      for (const [k, v] of Object.entries(b.refs)) if (typeof v === "string" && ids.has(v)) refs[k] = v;
    bodies.set(id, { id, title: "", content, summary: text(b.summary, 2000), slug: text(b.slug, 256), refs });
  }
  return async (id) => bodies.get(id) ?? null;
}

// The page may give the hub a layout and look: the viewer's exported config (version 1), in
// <script id="governor-settings" type="application/json">. Its graph source fields are ignored here.
function readSettings(): HubSettings | undefined {
  const el = document.getElementById("governor-settings");
  if (!el) return undefined;
  try { return parseSettings(JSON.parse(el.textContent!)); } catch { return undefined; }
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
    ? <Report nodes={graph.nodes} edges={graph.edges} hub={hub} light={light} details={readBodies(graph.nodes)} organic={document.documentElement.dataset.layout === "organic"} settings={readSettings()} />
    : <p className="report-message">This graph has no committed nodes yet.</p>);
} catch {
  root.textContent = "Graph unavailable. Reload the report to try again.";
}
