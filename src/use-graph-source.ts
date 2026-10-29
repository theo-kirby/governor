import { useEffect, useMemo, useState } from "react";
import type { NodeDetail, Snapshot } from "../shared/types";
import type { HubSettings } from "./hub-settings";
import { generateGraph } from "./generated-graph";

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(import.meta.env.BASE_URL + path, {signal, headers: {"X-Flywheel-Viewer": "1"}});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to read graph.");
  return data;
}
const empty = {nodes: [], edges: []};
export function useGraphSource(settings: HubSettings, defaultRepo: string) {
  const {graphSource, repoPath, graphSeed, graphStates, graphRecords, graphDepth, graphBranches, graphCitations} = settings;
  const repo = repoPath || defaultRepo;
  const [loaded, setLoaded] = useState<{repo: string; graph: Pick<Snapshot, "nodes" | "edges">; message: string}>({repo: "", graph: empty, message: ""});
  useEffect(() => {
    if (graphSource !== "repo" || !repo) return;
    const controller = new AbortController();
    setLoaded({repo, graph: empty, message: "Loading repository…"});
    void (async () => {
      const graph = await read<Snapshot>(`api/graph?${new URLSearchParams({repo})}`, controller.signal);
      if (controller.signal.aborted) return;
      setLoaded({repo, graph, message: `${graph.nodes.length} nodes · ${graph.edges.length} edges`});
      if (graph.head && graph.nodes.length) {
        try {
          const tagged = await read<Snapshot>(`api/graph?${new URLSearchParams({repo, tags: "1", head: graph.head})}`, controller.signal);
          if (!controller.signal.aborted) setLoaded({repo, graph: tagged, message: `${tagged.nodes.length} nodes · ${tagged.edges.length} edges`});
        } catch {
          if (!controller.signal.aborted) setLoaded({repo, graph, message: "Graph loaded; tags unavailable."});
        }
      }
    })().catch(error => {
      if (!controller.signal.aborted) setLoaded({repo, graph: empty, message: error instanceof Error ? error.message : "Unable to read repository."});
    });
    return () => controller.abort();
  }, [graphSource, repo]);
  const generated = useMemo(() => graphSource === "repo" ? empty : generateGraph({graphSource, graphSeed, graphStates, graphRecords, graphDepth, graphBranches, graphCitations}), [graphSource, graphSeed, graphStates, graphRecords, graphDepth, graphBranches, graphCitations]);
  const graph = graphSource === "repo" ? (loaded.repo === repo ? loaded.graph : empty) : generated;
  const details = useMemo(() => graphSource === "repo" ? async (id: string, signal: AbortSignal) => read<NodeDetail>(`api/node?${new URLSearchParams({repo, id})}`, signal) : async (id: string) => {
    const node = generated.nodes.find(n => n.id === id)!;
    return {id, title: node.title, content: `Synthetic ${node.tags?.[0].name} from seed ${graphSeed}.`, refs: {}};
  }, [graphSource, repo, generated, graphSeed]);
  return {...graph, details, message: graphSource === "repo" ? (!repo ? "Enter a repository path to load a graph." : loaded.repo === repo ? loaded.message : "Loading repository…") : `${graph.nodes.length} nodes · ${graph.edges.length} edges · seed ${graphSeed}`};
}
