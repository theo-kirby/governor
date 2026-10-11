import type { GraphNode, GraphEdge } from "../shared/types";

// Synthetic visual template. Keep IDs stable when changing titles or relationships.
// Edit these two lists to try a different graph; no Flywheel repository is needed.
const nodeDefinitions: [id: string, title: string, parentId: string | null][] =
  [
    ["research", "Research", null],
    ["record", "Record", "research"],
    ["state", "State", "research"],
    ["reference", "Reference", "research"],
    ["question", "Question", "record"],
    ["baseline", "Baseline", "record"],
    ["experiment", "Experiment", "record"],
    ["result", "Result", "record"],
    ["hypothesis", "Hypothesis", "state"],
    ["findings", "Findings", "state"],
    ["decision", "Decision", "state"],
    ["next-step", "Next step", "state"],
    ["methods", "Methods", "reference"],
    ["dataset", "Dataset", "reference"],
    ["reading", "Reading", "reference"],
    ["glossary", "Glossary", "reference"],
  ];

const semanticDefinitions: [scope: string, source: string, target: string][] = [
  ["record", "question", "baseline"],
  ["record", "baseline", "experiment"],
  ["record", "experiment", "result"],
  ["state", "hypothesis", "findings"],
  ["state", "findings", "decision"],
  ["state", "decision", "next-step"],
];

const edges: GraphEdge[] = [
  ...nodeDefinitions.flatMap(([id, , parentId]) =>
    parentId
      ? [
          {
            id: `containment:${id}`,
            source: parentId,
            target: id,
            kind: "containment" as const,
          },
        ]
      : [],
  ),
  ...semanticDefinitions.map(([scope, source, target]) => ({
    id: `semantic:${source}:${target}`,
    source,
    target,
    scope,
    kind: "semantic" as const,
  })),
];
const nodes: GraphNode[] = nodeDefinitions.map(([id, title, parentId]) => ({
  id,
  title,
  parentId,
  childCount: nodeDefinitions.filter((node) => node[2] === id).length,
  edgeCount: semanticDefinitions.filter((edge) => edge[0] === id).length,
  lifecycle: "live",
}));

const demoTags: Record<string, string[]> = {
  question: ["open"],
  baseline: ["reference"],
  experiment: ["active", "review"],
  result: ["verified"],
  hypothesis: ["active"],
  findings: ["review"],
  decision: ["verified"],
  "next-step": ["blocked"],
  methods: ["reference"],
  dataset: ["reference"],
};
for (const node of nodes)
  node.tags = (demoTags[node.id] || []).map((name) => ({
    id: `demo-tag-${name}`,
    name,
  }));
export const demoGraph = { nodes, edges };
