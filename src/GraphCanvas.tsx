import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import type { GraphNode, GraphEdge } from "../shared/types";
import { layoutGraph, NODE_DIAMETER, CONTAINER_DIAMETER } from "./layout";
import { outwardBend } from "./edge-curves";
import { nodeLabel } from "./node-label";

export interface GraphTuning {
  ringGap: number;
  spacing: number;
  curvature: number;
  labels: boolean;
  tags: boolean;
  tagFilter: string;
  overview: boolean;
}
const defaultTuning: GraphTuning = {
  ringGap: 180,
  spacing: 140,
  curvature: 1,
  labels: true,
  tags: true,
  tagFilter: "",
  overview: false,
};

function fitGraph(graph: Core) {
  graph.resize();
  if (!graph.nodes().length) return;
  graph.fit(undefined, 48);
  if (graph.zoom() > 1) {
    graph.zoom(1);
    graph.center();
  }
}

export function Graph({
  nodes,
  edges,
  label = "Committed graph",
  tuning = defaultTuning,
  onLayout,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label?: string;
  tuning?: GraphTuning;
  onLayout?: (milliseconds: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const camera = useRef<{
    key: string;
    zoom: number;
    pan: { x: number; y: number };
    selected: string[];
  } | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // Annotations can arrive after topology. Keep the view when geometry is unchanged.
    const geometryKey = JSON.stringify([
      nodes.map(({ tags: _tags, ...node }) => node),
      edges,
      tuning.ringGap,
      tuning.spacing,
    ]);
    const started = performance.now();
    const positions = layoutGraph(nodes, edges, tuning);
    onLayout?.(performance.now() - started);
    const ids = new Set(nodes.map((node) => node.id));
    const graph = cytoscape({
      container: element,
      elements: [
        ...nodes.map((node) => ({
          data: {
            id: node.id,
            label: nodeLabel(node, tuning.labels, tuning.tags),
            tagged: tuning.tags && node.tags?.length ? 1 : 0,
            container: node.childCount > 0 ? 1 : 0,
          },
          position: positions.get(node.id),
          classes:
            tuning.tagFilter &&
            !node.tags?.some((tag) => tag.name === tuning.tagFilter)
              ? "dimmed"
              : "",
        })),
        ...edges
          .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
          .map((edge) => ({
            data: {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              kind: edge.kind,
              bend:
                outwardBend(
                  positions.get(edge.source)!,
                  positions.get(edge.target)!,
                ) * tuning.curvature,
            },
          })),
      ],
      style: [
        {
          selector: "node",
          style: {
            shape: "ellipse",
            width: NODE_DIAMETER,
            height: NODE_DIAMETER,
            "background-color": "#222222",
            "border-color": "#999999",
            "border-width": 1,
            label: "data(label)",
            color: "#cccccc",
            "font-family": "system-ui",
            "font-size": 11,
            "text-valign": "bottom",
            "text-margin-y": 9,
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-overflow-wrap": "anywhere",
            "text-max-width": "112px",
            "min-zoomed-font-size": 7,
          },
        },
        {
          selector: "node[container = 1]",
          style: {
            width: CONTAINER_DIAMETER,
            height: CONTAINER_DIAMETER,
            "background-color": "#555555",
            "border-color": "#dddddd",
            color: "#ffffff",
            "font-weight": 600,
          },
        },
        {
          selector: "node[tagged = 1]",
          style: { "border-width": 2, "border-color": "#dddddd" },
        },
        { selector: "node.dimmed", style: { opacity: 0.18 } },
        {
          selector: "node:selected",
          style: {
            "border-color": "#ffffff",
            "border-width": 2,
            "background-color": "#333333",
            color: "#ffffff",
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "unbundled-bezier",
            "control-point-distances": "data(bend)",
            "control-point-weights": 0.5,
            width: 1,
            "line-color": "#555555",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#555555",
            "arrow-scale": 0.7,
          },
        },
        {
          selector: 'edge[kind = "containment"]',
          style: {
            "line-style": "dashed",
            "line-color": "#444444",
            "target-arrow-color": "#444444",
          },
        },
        {
          selector: 'edge[kind = "semantic"]',
          style: {
            width: 1.5,
            "line-color": "#bbbbbb",
            "target-arrow-color": "#bbbbbb",
          },
        },
      ],
      layout: { name: "preset", fit: false },
      minZoom: 0.001,
      maxZoom: 4,
      wheelSensitivity: 0.2,
      autoungrabify: true,
      boxSelectionEnabled: false,
    });
    fitGraph(graph);
    // A graph with hundreds of siblings becomes too small to read
    // when fully fitted. Start at its root at a readable scale; F still fits all.
    if (!tuning.overview && nodes.length && graph.zoom() < 0.5) {
      const root = nodes.find((node) => !node.parentId) || nodes[0];
      const position = positions.get(root.id)!;
      const zoom = 0.85;
      graph.zoom(zoom);
      graph.pan({
        x: graph.width() / 2 - position.x * zoom,
        y: graph.height() / 2 - position.y * zoom,
      });
    }
    if (camera.current?.key === geometryKey) {
      graph.zoom(camera.current.zoom);
      graph.pan(camera.current.pan);
      for (const id of camera.current.selected)
        graph.getElementById(id).select();
    }
    const observer = new ResizeObserver(() => graph.resize());
    observer.observe(element);
    const keyboard = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (
        [
          "+",
          "=",
          "-",
          "f",
          "0",
          "arrowleft",
          "arrowright",
          "arrowup",
          "arrowdown",
        ].includes(key)
      )
        event.preventDefault();
      if (key === "f" || key === "0") fitGraph(graph);
      if (key === "+" || key === "=" || key === "-")
        graph.zoom({
          level: graph.zoom() * (key === "-" ? 1 / 1.3 : 1.3),
          renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 },
        });
      const delta = {
        arrowleft: { x: 60, y: 0 },
        arrowright: { x: -60, y: 0 },
        arrowup: { x: 0, y: 60 },
        arrowdown: { x: 0, y: -60 },
      }[key];
      if (delta) graph.panBy(delta);
    };
    element.addEventListener("keydown", keyboard);
    return () => {
      observer.disconnect();
      element.removeEventListener("keydown", keyboard);
      camera.current = {
        key: geometryKey,
        zoom: graph.zoom(),
        pan: { ...graph.pan() },
        selected: graph.nodes(":selected").map((node) => node.id()),
      };
      graph.destroy();
    };
  }, [nodes, edges, tuning, onLayout]);

  return (
    <div
      ref={container}
      className="graph-canvas"
      tabIndex={0}
      role="img"
      aria-label={`${label} with ${nodes.length} nodes and ${edges.length} relationships, arranged radially. ${nodes.filter((node) => node.tags?.length).length} tagged nodes. Drag to pan, scroll to zoom. Keyboard: arrows to pan, plus or minus to zoom, F to fit.`}
    />
  );
}
