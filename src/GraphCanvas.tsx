import { useEffect, useRef, useMemo, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import type { GraphNode, GraphEdge } from "../shared/types";
import { layoutGraph, NODE_DIAMETER, CONTAINER_DIAMETER } from "./layout";
import { outwardBend } from "./edge-curves";
import { collapseBranches } from "./collapse-branches";
import { collapseChains } from "./collapse-chains";
import { nodeLabel } from "./node-label";

export interface GraphTuning {
  ringGap: number;
  spacing: number;
  curvature: number;
  labels: boolean;
  tags: boolean;
  tagFilter: string;
  overview: boolean;
  chains?: boolean;
  branchesCollapsed?: boolean;
  rings?: "compact" | "adaptive" | "classic";
  appearance?: "mono" | "roles";
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

type GraphProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label?: string;
  tuning?: GraphTuning;
  onLayout?: (milliseconds: number) => void;
};
export function Graph(props: GraphProps) {
  const [expanded, setExpanded] = useState(new Set<string>());
  const enabled =
    props.tuning?.chains ??
    new URLSearchParams(location.search).get("chains") !== "0";
  const projected = useMemo(
    () => collapseChains(props.nodes, props.edges, expanded),
    [props.nodes, props.edges, expanded],
  );
  const branchEnabled =
    props.tuning?.branchesCollapsed ??
    new URLSearchParams(location.search).get("branchesCollapsed") !== "0";
  const baseline = useMemo(
    () => collapseChains(props.nodes, props.edges),
    [props.nodes, props.edges],
  );
  const useBranches =
    branchEnabled &&
    (enabled ? baseline.nodes.length : props.nodes.length) > 40;
  const source = enabled ? projected : props;
  const folded = useMemo(
    () =>
      useBranches
        ? collapseBranches(
            source.nodes,
            source.edges,
            expanded,
            new Set(
              [...expanded].flatMap((id) => projected.groups.get(id) || []),
            ),
          )
        : null,
    [useBranches, source.nodes, source.edges, expanded],
  );
  const summaryGroups = useMemo(() => {
    const result = new Map(enabled ? projected.groups : []);
    for (const [id, members] of folded?.groups || [])
      result.set(
        id,
        members.flatMap((member) =>
          enabled ? projected.groups.get(member) || [member] : [member],
        ),
      );
    return result;
  }, [enabled, projected.groups, folded]);
  return (
    <GraphView
      {...props}
      nodes={folded?.nodes ?? source.nodes}
      edges={folded?.edges ?? source.edges}
      chains={summaryGroups}
      branchOverview={useBranches}
      originalCount={props.nodes.length}
      expand={(id) => setExpanded((previous) => new Set([...previous, id]))}
      collapse={() => setExpanded(new Set())}
    />
  );
}
function GraphView({
  nodes,
  edges,
  label = "Committed graph",
  tuning = defaultTuning,
  onLayout,
  chains,
  branchOverview,
  originalCount,
  expand,
  collapse,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label?: string;
  tuning?: GraphTuning;
  onLayout?: (milliseconds: number) => void;
  chains: Map<string, string[]>;
  branchOverview: boolean;
  originalCount: number;
  expand: (id: string) => void;
  collapse: () => void;
}) {
  const actions = useRef({ expand, collapse });
  actions.current = { expand, collapse };
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
    const query = new URLSearchParams(location.search);
    const rings = tuning.rings ?? query.get("rings") ?? "classic";
    const roles = (tuning.appearance ?? query.get("appearance")) === "roles";
    const geometryKey = JSON.stringify([
      nodes.map(({ tags: _tags, ...node }) => node),
      edges,
      tuning.ringGap,
      tuning.spacing,
      rings,
    ]);
    const started = performance.now();
    const positions = layoutGraph(nodes, edges, {
      ...tuning,
      adaptive: rings !== "classic",
      compact: rings === "compact",
    });
    onLayout?.(performance.now() - started);
    const ids = new Set(nodes.map((node) => node.id));
    const incoming = new Map<string, Set<string>>(),
      outgoing = new Map<string, Set<string>>();
    const containment = edges.some((e) => e.kind === "containment");
    const parents = edges.some((e) => e.relation === "parent");
    for (const edge of edges) {
      if (
        !ids.has(edge.source) ||
        !ids.has(edge.target) ||
        edge.source === edge.target ||
        (containment
          ? edge.kind !== "containment"
          : parents
            ? edge.relation !== "parent"
            : edge.relation === "citation")
      )
        continue;
      if (!incoming.has(edge.target)) incoming.set(edge.target, new Set());
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, new Set());
      incoming.get(edge.target)!.add(edge.source);
      outgoing.get(edge.source)!.add(edge.target);
    }
    const role = (node: GraphNode) => {
      if (node.tags?.some((t) => t.id === "graph:plan")) return "root";
      if (node.tags?.some((t) => t.id === "graph:state")) return "fork";
      if ((incoming.get(node.id)?.size ?? 0) > 1) return "merge";
      if (!incoming.has(node.id)) return "root";
      return (outgoing.get(node.id)?.size ?? 0) > 1 ? "fork" : "step";
    };
    const graph = cytoscape({
      container: element,
      elements: [
        ...nodes.map((node) => ({
          data: {
            id: node.id,
            role: roles ? role(node) : "step",
            chain: chains.get(node.id)?.length ?? 0,
            label: chains.has(node.id)
              ? tuning.labels
                ? `${chains.get(node.id)!.length} nodes`
                : ""
              : nodeLabel(node, tuning.labels, tuning.tags),
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
              context: branchOverview && edge.kind !== "containment" ? 1 : 0,
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
          selector: "node.hovered, node:selected",
          style: {
            "min-zoomed-font-size": 0,
            "text-background-color": "#000000",
            "text-background-opacity": 1,
            "text-background-padding": "3px",
            "z-index": 20,
          },
        },
        {
          selector: "edge.traced",
          style: {
            "line-color": "#ffffff",
            "target-arrow-color": "#ffffff",
            "z-index": 10,
          },
        },
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
        ...(roles
          ? [
              {
                selector: 'node[role = "root"]',
                style: {
                  shape: "diamond" as const,
                  "background-color": "#b99a60",
                  "border-color": "#e2c68b",
                },
              },
              {
                selector: 'node[role = "fork"]',
                style: {
                  "background-color": "#508f9d",
                  "border-color": "#90c9d5",
                },
              },
              {
                selector: 'node[role = "merge"]',
                style: {
                  shape: "hexagon" as const,
                  "background-color": "#8974ab",
                  "border-color": "#bdabdc",
                },
              },
            ]
          : []),
        { selector: "edge[context = 1]", style: { opacity: 0.06 } },
        {
          selector: "node[chain > 0]",
          style: {
            shape: "round-rectangle",
            "background-color": "#111111",
            "border-color": "#dddddd",
            "background-image":
              "data:image/svg+xml;utf8," +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><rect x="8" y="7" width="25" height="23" rx="5" fill="#111" stroke="#777"/><rect x="5" y="12" width="25" height="23" rx="5" fill="#222" stroke="#aaa"/><rect x="11" y="17" width="27" height="21" rx="5" fill="#222" stroke="#ddd"/><g fill="#eee"><circle cx="18" cy="27" r="1.7"/><circle cx="24" cy="27" r="1.7"/><circle cx="30" cy="27" r="1.7"/></g></svg>',
              ),
            "background-fit": "contain",
          },
        },
        {
          selector: "edge.traced",
          style: {
            "line-color": "#ffffff",
            "target-arrow-color": "#ffffff",
            opacity: 1,
          },
        },
      ],
      layout: { name: "preset", fit: false },
      minZoom: 0.000001,
      maxZoom: 4,
      wheelSensitivity: 0.2,
      autoungrabify: true,
      boxSelectionEnabled: false,
    });
    fitGraph(graph);
    if (camera.current?.key === geometryKey) {
      graph.zoom(camera.current.zoom);
      graph.pan(camera.current.pan);
      for (const id of camera.current.selected)
        graph.getElementById(id).select();
    }
    const large = nodes.length > 40;
    const updateDetail = () => {
      const zoom = graph.zoom();
      if (large) {
        // Keep small glyphs visible at overview without consuming their spacing.
        const minimum = Math.min(
          3.5 / zoom,
          Math.min(tuning.spacing, tuning.ringGap) * 0.8,
        );
        graph.batch(() => {
          graph.nodes().forEach((node) => {
            const size = Math.max(
              node.data("container") ? CONTAINER_DIAMETER : NODE_DIAMETER,
              minimum,
            );
            node.style({
              width: size,
              height: size,
              "border-width": Math.min(2 / zoom, size * 0.14),
              "font-size":
                node.selected() || node.hasClass("hovered") ? 11 / zoom : 11,
              "text-max-width":
                node.selected() || node.hasClass("hovered") ? 220 / zoom : 112,
              "text-margin-y":
                node.selected() || node.hasClass("hovered") ? 9 / zoom : 9,
            });
          });
          graph.edges().forEach((edge) => {
            edge.style({
              width: Math.max(
                edge.data("kind") === "semantic" ? 1.5 : 1,
                (edge.hasClass("traced") ? 1.1 : 0.25) / zoom,
              ),
              opacity: edge.hasClass("traced")
                ? 1
                : edge.data("context")
                  ? 0.06
                  : zoom < 0.25
                    ? 0.22
                    : zoom < 0.5
                      ? 0.5
                      : 1,
            });
          });
        });
      }
      const extent = graph.extent();
      element.dataset.visibleNodes = String(
        graph.nodes().filter((node) => {
          const p = node.position();
          return (
            p.x >= extent.x1 &&
            p.x <= extent.x2 &&
            p.y >= extent.y1 &&
            p.y <= extent.y2
          );
        }).length,
      );
      element.dataset.nodes = String(nodes.length);
      element.dataset.originalNodes = String(originalCount);
      element.dataset.collapsedChains = String(
        nodes.filter((n) => chains.has(n.id)).length,
      );
      element.dataset.zoom = String(zoom);
    };
    const emphasize = () => {
      graph.elements().removeClass("traced");
      const focus = graph.nodes(":selected").union(graph.nodes(".hovered"));
      focus.closedNeighborhood().addClass("traced");
      updateDetail();
    };
    graph.on("tap", "node[chain > 0]", (event) =>
      actions.current.expand(event.target.id()),
    );
    graph.on("zoom pan", updateDetail);
    graph.on("select unselect", "node", emphasize);
    graph.on("mouseover", "node", (event) => {
      event.target.addClass("hovered");
      element.title =
        nodes.find((node) => node.id === event.target.id())?.title || "";
      emphasize();
    });
    graph.on("mouseout", "node", (event) => {
      event.target.removeClass("hovered");
      element.title = "";
      emphasize();
    });
    emphasize();
    // Ignore the initial observer notification so late tag enrichment keeps the camera.
    let width = element.clientWidth,
      height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth || height !== element.clientHeight) {
        width = element.clientWidth;
        height = element.clientHeight;
        fitGraph(graph);
        updateDetail();
      }
    });
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
      if (key === "c") actions.current.collapse();
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
      aria-label={`${label} with ${nodes.length} nodes and ${edges.length} relationships, arranged radially. ${originalCount} original nodes. Click a summary marker to expand; C to collapse summaries. ${nodes.filter((node) => node.tags?.length).length} tagged nodes. Drag to pan, scroll to zoom. Keyboard: arrows to pan, plus or minus to zoom, F to fit.`}
    />
  );
}
