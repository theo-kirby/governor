import type { GraphNode, GraphEdge } from "../shared/types";
import { demoGraph } from "./demo";

export const shapes = {
  demo: ["Research demo", "The original 16-node reference graph."],
  random: [
    "Random structure",
    "Seeded uneven branches and disconnected roots. Optional cross-links add stress.",
  ],
  tree: [
    "Balanced tree",
    "Regular branching: check ring spacing and label collisions.",
  ],
  chain: [
    "Deep chain",
    "One child per node: tests depth and long radial spokes.",
  ],
  star: ["Wide star", "One root with many leaves: tests crowded outer rings."],
  lopsided: [
    "Lopsided tree",
    "A deep trunk plus a large fan: tests unequal branch sizes.",
  ],
  diamond: [
    "Repeated merges",
    "Multiple parents converge on shared nodes. Every edge should remain visible.",
  ],
  cycle: [
    "Directed cycle",
    "No natural root: tests cycle handling and the closing edge.",
  ],
  islands: [
    "Disconnected islands",
    "Separate components: tests placement without one shared root.",
  ],
  dense: [
    "Dense graph",
    "Many cross-links: tests edge crossings and visual overload. Limited to 60 nodes.",
  ],
  loops: [
    "Loops & parallel edges",
    "Self-loops, duplicate links, and reverse links. Overlaps are intentional stress cases.",
  ],
  single: ["Single node", "The smallest nonempty graph."],
  empty: ["Empty graph", "No nodes or edges: tests the empty canvas."],
} as const;
export type Shape = keyof typeof shapes;
export interface DebugSettings {
  shape: Shape;
  count: number;
  branches: number;
  seed: number;
  density: number;
  crossLinks: boolean;
  ringGap: number;
  spacing: number;
  curvature: number;
  labels: boolean;
  tags: boolean;
  tagRate: number;
  tagFilter: string;
}
export const debugDefaults: DebugSettings = {
  shape: "demo",
  count: 36,
  branches: 3,
  seed: 1,
  density: 0.2,
  crossLinks: false,
  ringGap: 180,
  spacing: 140,
  curvature: 1,
  labels: true,
  tags: true,
  tagRate: 0.45,
  tagFilter: "",
};
export function normalizeSettings(
  value: Partial<DebugSettings>,
): DebugSettings {
  const number = (
    key: keyof DebugSettings,
    min: number,
    max: number,
    integer = false,
  ) => {
    const raw = Number(value[key] ?? debugDefaults[key]);
    const result = Math.min(
      max,
      Math.max(min, Number.isFinite(raw) ? raw : Number(debugDefaults[key])),
    );
    return integer ? Math.round(result) : result;
  };
  return {
    shape:
      value.shape && Object.hasOwn(shapes, value.shape) ? value.shape : "demo",
    count: number("count", 2, value.shape === "dense" ? 60 : 200, true),
    branches: number("branches", 2, 8, true),
    seed: number("seed", 1, 99999, true),
    density: number("density", 0, 1),
    crossLinks: value.crossLinks === true,
    ringGap: number("ringGap", 70, 320),
    spacing: number("spacing", 50, 240),
    curvature: number("curvature", 0, 2.5),
    labels: value.labels !== false,
    tags: value.tags !== false,
    tagRate: number("tagRate", 0, 1),
    tagFilter:
      typeof value.tagFilter === "string" ? value.tagFilter.slice(0, 256) : "",
  };
}
export function settingsFromUrl(query: URLSearchParams) {
  const value: Record<string, unknown> = {};
  for (const key of Object.keys(debugDefaults)) {
    if (!query.has(key)) continue;
    value[key] =
      key === "shape" || key === "tagFilter"
        ? query.get(key)
        : key === "labels" || key === "tags" || key === "crossLinks"
          ? query.get(key) !== "0"
          : Number(query.get(key));
  }
  return normalizeSettings(value as Partial<DebugSettings>);
}
export function debugQuery(settings: DebugSettings) {
  const query = new URLSearchParams({ debug: "1" });
  for (const [key, value] of Object.entries(settings))
    query.set(
      key,
      key === "labels" || key === "tags" || key === "crossLinks"
        ? value
          ? "1"
          : "0"
        : String(value),
    );
  return query;
}
export function generateDebugGraph(input: DebugSettings) {
  const settings = normalizeSettings(input);
  if (settings.shape === "demo") return demoGraph;
  const count =
    settings.shape === "empty"
      ? 0
      : settings.shape === "single"
        ? 1
        : Math.min(settings.count, settings.shape === "dense" ? 60 : 200);
  const nodes: GraphNode[] = Array.from({ length: count }, (_, index) => ({
    id: `debug-${index}`,
    title: `Node ${index + 1}`,
    parentId: null,
    childCount: 0,
    edgeCount: 0,
    lifecycle: "live",
  }));
  const edges: GraphEdge[] = [];
  const add = (
    source: number,
    target: number,
    kind: GraphEdge["kind"] = "containment",
  ) => {
    if (!nodes[source] || !nodes[target]) return;
    edges.push({
      id: `debug-edge-${edges.length}`,
      source: nodes[source].id,
      target: nodes[target].id,
      kind,
    });
    if (kind === "containment") {
      nodes[target].parentId = nodes[source].id;
      nodes[source].childCount++;
    }
  };
  let seed = settings.seed;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  switch (settings.shape) {
    case "random": {
      for (let i = 1; i < count; i++) {
        if (random() > 0.12) add(Math.floor(random() * i), i);
      }
      const pairs = new Set<string>();
      const attempts = settings.crossLinks
        ? Math.round(count * settings.density * 4)
        : 0;
      for (let i = 0; i < attempts; i++) {
        const source = Math.floor(random() * count),
          target = Math.floor(random() * count);
        const key = `${source}:${target}`;
        if (source !== target && !pairs.has(key)) {
          add(source, target, "semantic");
          pairs.add(key);
        }
      }
      break;
    }
    case "tree":
      for (let i = 1; i < count; i++)
        add(Math.floor((i - 1) / settings.branches), i);
      break;
    case "chain":
      for (let i = 1; i < count; i++) add(i - 1, i);
      break;
    case "star":
      for (let i = 1; i < count; i++) add(0, i);
      break;
    case "lopsided": {
      const trunk = Math.max(1, Math.floor(count * 0.6));
      for (let i = 1; i < count; i++)
        add(i < trunk ? i - 1 : i % 4 ? trunk - 1 : 0, i);
      break;
    }
    case "diamond": {
      let parent = 0;
      for (let i = 1; i < count; i += 3) {
        add(parent, i, "semantic");
        add(parent, i + 1, "semantic");
        add(i, i + 2, "semantic");
        add(i + 1, i + 2, "semantic");
        parent = i + 2;
      }
      break;
    }
    case "cycle":
      for (let i = 0; i < count; i++) add(i, (i + 1) % count, "semantic");
      break;
    case "islands": {
      const size = Math.ceil(count / settings.branches);
      for (let i = 0; i < count; i++) {
        const root = Math.floor(i / size) * size;
        if (i !== root) add(root + Math.floor((i - root - 1) / 2), i);
      }
      break;
    }
    case "dense":
      for (let i = 0; i < count; i++)
        for (let j = i + 1; j < count; j++)
          if (random() < settings.density) add(i, j, "semantic");
      break;
    case "loops":
      for (let i = 1; i < count; i++) add(0, i);
      for (let i = 0; i < count; i++) {
        add(i, i, "semantic");
        if (i) {
          add(0, i, "semantic");
          add(0, i, "semantic");
          add(i, 0, "semantic");
        }
      }
      break;
  }
  // A separate seed stream keeps topology unchanged when tag coverage changes.
  seed = settings.seed ^ 0x9e3779b9;
  const tagNames = ["active", "review", "blocked", "reference"];
  for (const node of nodes) {
    if (random() < settings.tagRate) {
      const first = Math.floor(random() * tagNames.length);
      const indices = [first];
      if (random() < 0.3) indices.push((first + 1) % tagNames.length);
      node.tags = indices.map((index) => ({
        id: `debug-tag-${tagNames[index]}`,
        name: tagNames[index],
      }));
    } else node.tags = [];
  }
  return { nodes, edges };
}
