import { lazy, Suspense, useEffect, useState } from "react";
import type { Snapshot } from "../shared/types";
import { demoGraph } from "./demo";

const Graph = lazy(() =>
  import("./FlywheelCanvas").then((module) => ({
    default: module.FlywheelCanvas,
  })),
);

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { "X-Flywheel-Viewer": "1" },
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to read the graph.");
  return data;
}

const Hub = lazy(() =>
  import("./HubCanvas").then((module) => ({ default: module.HubCanvas })),
);

const DebugView = lazy(() =>
  import("./DebugView").then((module) => ({ default: module.DebugView })),
);

export function App() {
  return new URLSearchParams(location.search).has("debug") ? (
    <Suspense fallback={null}>
      <DebugView />
    </Suspense>
  ) : (
    <Viewer />
  );
}

function Viewer() {
  const [snapshot, setSnapshot] = useState<Pick<
    Snapshot,
    "nodes" | "edges"
  > | null>(null);
  const [status, setStatus] = useState("Loading graph");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const query = new URLSearchParams(window.location.search);
      const showDemo = () => {
        setSnapshot(demoGraph);
        setStatus("Demo graph");
      };
      if (query.has("demo")) {
        showDemo();
        return;
      }
      const requested = query.get("repo");
      let repo = requested?.trim();
      if (!repo) {
        const config = await read<{ defaultRepo: string }>(
          "/api/config",
          controller.signal,
        );
        repo = config.defaultRepo;
      }
      if (!repo) {
        try {
          repo = localStorage.getItem("flywheel-viz:repo") || "";
        } catch {
          /* Optional preference. */
        }
      }
      if (!repo) {
        showDemo();
        return;
      }
      const graphQuery = new URLSearchParams({ repo });
      for (const option of ["view", "citations", "source"]) {
        const value = query.get(option);
        if (value !== null) graphQuery.set(option, value);
      }
      const data = await read<Snapshot>(
        `/api/graph?${graphQuery}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSnapshot(data);
      setStatus(
        data.source === "hypergraph"
          ? "Hypergraph working-tree graph"
          : data.nodes.length
            ? "Committed graph"
            : "No committed nodes",
      );
      for (const warning of data.warnings || [])
        console.warn("Graph viewer:", warning);
      try {
        localStorage.setItem("flywheel-viz:repo", data.repo);
      } catch {
        /* Optional preference. */
      }
      if (data.head && data.nodes.length) {
        setStatus("Committed graph; loading tags");
        try {
          const tagged = await read<Snapshot>(
            `/api/graph?${new URLSearchParams({ repo: data.repo, tags: "1", head: data.head })}`,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setSnapshot(tagged);
          setStatus("Committed graph");
        } catch (error) {
          if (controller.signal.aborted) return;
          setStatus("Committed graph; tags unavailable");
          console.error("Flywheel viewer tags:", error);
        }
      }
    }
    void load().catch((error) => {
      if (!controller.signal.aborted) {
        setStatus("Graph unavailable");
        console.error(
          "Flywheel viewer:",
          error instanceof Error ? error.message : "Graph read failed.",
        );
      }
    });
    return () => controller.abort();
  }, []);

  return (
    <main
      className="graph-screen"
      aria-label={status}
      aria-busy={status === "Loading graph"}
    >
      {snapshot && (
        <Suspense fallback={null}>
          {new URLSearchParams(location.search).get("layout") === "hub" ? (
            <Hub nodes={snapshot.nodes} edges={snapshot.edges} label={status} />
          ) : (
            <Graph nodes={snapshot.nodes} edges={snapshot.edges} label={status} />
          )}
        </Suspense>
      )}
    </main>
  );
}
