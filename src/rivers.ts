import dagre from "@dagrejs/dagre";
import type { GraphNode, GraphEdge } from "../shared/types";

export type Point = { x: number; y: number };
export type RiverOptions = { fold: number; ranker: string };
export function riverLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: RiverOptions,
) {
  const started = performance.now();
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const containment = valid.filter((e) => e.kind === "containment");
  const parents = valid.filter((e) => e.relation === "parent");
  const structure = containment.length
    ? containment
    : parents.length
      ? parents
      : valid.filter((e) => e.relation !== "citation");
  const structural = new Set(structure.map((e) => e.id));
  const incoming = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  const outgoing = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of structure)
    if (e.source !== e.target) {
      incoming.get(e.target)!.add(e.source);
      outgoing.get(e.source)!.add(e.target);
    }
  const threads: string[][] = [];
  const owner = new Map<string, number>();
  const predecessor = (id: string) => [...incoming.get(id)!][0];
  // Only contract unambiguous continuations. Branches and merges retain all links.
  const starts = nodes.filter(
    (n) =>
      incoming.get(n.id)!.size !== 1 ||
      outgoing.get(predecessor(n.id))!.size !== 1,
  );
  for (const node of [...starts, ...nodes]) {
    if (owner.has(node.id)) continue;
    const thread: string[] = [];
    const index = threads.length;
    let id = node.id;
    while (!owner.has(id)) {
      owner.set(id, index);
      thread.push(id);
      const children = outgoing.get(id)!;
      if (children.size !== 1) break;
      const next = [...children][0];
      if (incoming.get(next)!.size !== 1) break;
      id = next;
    }
    threads.push(thread);
  }
  const fold = Math.max(3, Math.min(24, Math.round(options.fold)));
  const step = 30,
    gap = 48,
    pad = 30;
  const graph = new dagre.graphlib.Graph()
    .setGraph({
      rankdir: "LR",
      ranker: options.ranker,
      nodesep: 32,
      ranksep: 55,
      marginx: 20,
      marginy: 20,
    })
    .setDefaultEdgeLabel(() => ({}));
  const local = new Map<string, Point>();
  threads.forEach((thread, index) => {
    const columns = Math.min(fold, thread.length);
    const rows = Math.ceil(thread.length / columns);
    thread.forEach((id, i) => {
      const row = Math.floor(i / columns),
        col = i % columns;
      local.set(id, {
        x: pad + (row % 2 ? columns - 1 - col : col) * step,
        y: pad + row * gap,
      });
    });
    graph.setNode(String(index), {
      width: pad * 2 + (columns - 1) * step,
      height: pad * 2 + (rows - 1) * gap,
    });
  });
  for (const e of structure) {
    const a = owner.get(e.source)!,
      b = owner.get(e.target)!;
    if (a !== b) graph.setEdge(String(a), String(b));
  }
  if (nodes.length) dagre.layout(graph);
  // Dagre supplies branch ordering. Pack the ordered threads into available space so
  // one wide fork cannot force hundreds of empty global lanes.
  const ordered = threads
    .map((_, index) => ({ index, box: graph.node(String(index)) }))
    .sort(
      (a, b) => a.box.y - b.box.y || a.box.x - b.box.x || a.index - b.index,
    );
  const area = ordered.reduce(
    (sum, { box }) => sum + (box.width + 32) * (box.height + 32),
    0,
  );
  const target = Math.max(
    500,
    Math.sqrt(area * 1.65),
    ...ordered.map(({ box }) => box.width),
  );
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  let width = 1,
    height = 1;
  const positions = new Map<string, Point>();
  for (const { index, box } of ordered) {
    let bestX = 24,
      bestY = Infinity;
    const candidates = new Set([24, ...placed.map((p) => p.x + p.width + 24)]);
    for (const x of candidates) {
      if (x + box.width > target + 24) continue;
      let y = 24;
      for (const p of placed)
        if (x < p.x + p.width + 24 && x + box.width + 24 > p.x)
          y = Math.max(y, p.y + p.height + 24);
      if (y < bestY || (y === bestY && x < bestX)) {
        bestX = x;
        bestY = y;
      }
    }
    placed.push({ x: bestX, y: bestY, width: box.width, height: box.height });
    for (const id of threads[index]) {
      const p = local.get(id)!;
      positions.set(id, { x: bestX + p.x, y: bestY + p.y });
    }
    width = Math.max(width, bestX + box.width + 24);
    height = Math.max(height, bestY + box.height + 24);
  }
  const routes = new Map<string, Point[]>();
  for (const e of valid) {
    const a = positions.get(e.source)!,
      b = positions.get(e.target)!;
    const from = owner.get(e.source)!,
      to = owner.get(e.target)!;
    if (structural.has(e.id) && from !== to) {
      // Lift junction links out of the bead rows; a straight run across a row
      // would falsely appear to connect every intervening node.
      const lift = 30 + Math.min(90, Math.abs(a.x - b.x) * 0.1);
      routes.set(e.id, [
        a,
        { x: a.x, y: a.y - lift },
        { x: b.x, y: b.y - lift },
        b,
      ]);
    } else routes.set(e.id, [a, b]);
  }
  return {
    positions,
    routes,
    owner,
    threads,
    structural,
    width,
    height,
    ms: performance.now() - started,
  };
}
