// `governor check`: the rules of docs/CONVENTIONS.md over one snapshot.
import { declaresNone, FOLD_PREFIX, parseEdge, ROOT_TAG, STATUSES } from "./model";
import { live, tail, type GraphSnapshot, type GNode } from "./snapshot";

export type Finding = { level: "violation" | "warning"; rule: string; node?: string; message: string };

export function check(s: GraphSnapshot, opts: { foldThreshold?: number; legacyBefore?: number } = {}): Finding[] {
  const out: Finding[] = [];
  const v = (rule: string, n: GNode | null, message: string) =>
    out.push({ level: "violation", rule, node: n ? n.slug || n.id : undefined, message });
  const w = (rule: string, n: GNode | null, message: string) =>
    out.push({ level: "warning", rule, node: n ? n.slug || n.id : undefined, message });
  const nodes = live(s);
  const roots = nodes.filter((n) => n.tags.includes(ROOT_TAG));
  if (roots.length !== 1) v("G1", null, `expected one root tagged \`${ROOT_TAG}\`, found ${roots.length}`);
  const legacy = (n: GNode) => opts.legacyBefore !== undefined && n.seq < opts.legacyBefore;

  for (const n of nodes) {
    if (n.id === s.root) continue;
    if (n.container !== s.root) v("G1", n, "not contained in the root");
    const kinds = n.tags.filter((t) => t === "record" || t === "state" || t === "plan");
    if (kinds.length !== 1) v("G1", n, `carries ${kinds.length} kind tags (${kinds.join(", ") || "none"})`);
  }

  const outEdges = new Map<string, typeof s.edges>();
  const inEdges = new Map<string, typeof s.edges>();
  for (const e of s.edges) {
    (outEdges.get(e.source) ?? outEdges.set(e.source, []).get(e.source)!).push(e);
    (inEdges.get(e.target) ?? inEdges.set(e.target, []).get(e.target)!).push(e);
  }

  for (const n of nodes.filter((n) => n.kind === "record")) {
    const later = n.editedBy.filter(Boolean);
    if (later.length) v("G2", n, `record edited after creation by: ${[...new Set(later)].join(" | ").slice(0, 160)}`);
    const impacts = (outEdges.get(n.id) ?? []).filter((e) => parseEdge(e.content).relation === "impact");
    if (!impacts.length && !declaresNone(n.content) && !/^- NEW /m.test(n.content) && !legacy(n))
      v("G3", n, "declares no state impact (no impact edge, no NEW line, no `none:`)");
    for (const p of n.parents) {
      const k = s.nodes[p]?.kind;
      if (k !== "record" && k !== "root") v("G6", n, `record parent is a ${k} node`);
    }
  }

  for (const n of nodes.filter((n) => n.kind === "state" || n.kind === "plan")) {
    const statuses = n.tags.filter((t) => (STATUSES as readonly string[]).includes(t));
    const component = n.parents.includes(s.root ?? "") && !statuses.length;
    if (!component && statuses.length !== 1) v("G4", n, `carries ${statuses.length} status tags`);
    const cites = (outEdges.get(n.id) ?? []).filter((e) => s.nodes[e.target]?.kind === "record");
    if (!component && !cites.length && n.status !== "open" && n.status !== "superseded")
      v("G4", n, `a ${n.status} claim cites no record`);
    for (const p of n.parents) {
      const k = s.nodes[p]?.kind;
      if (k !== n.kind && k !== "root") v("G6", n, `${n.kind} parent is a ${k} node`);
    }
    for (const e of inEdges.get(n.id) ?? [])
      if (s.nodes[e.source]?.kind !== "record") v("G5", n, `an edge into a claim comes from a ${s.nodes[e.source]?.kind} node`);
  }

  for (const e of s.edges) {
    const a = s.nodes[e.source]?.kind,
      b = s.nodes[e.target]?.kind;
    const ok = (a === "record" && (b === "state" || b === "plan")) || ((a === "state" || a === "plan") && b === "record");
    if (!ok) v("G5", s.nodes[e.source] ?? null, `edge ${a} → ${b} is neither an impact nor a citation`);
  }

  // G5: every relation line names a node of the right kind (old imported text only warns)
  for (const d of s.dangling ?? []) {
    const n = s.nodes[d.node] ?? null;
    (n && legacy(n) ? w : v)("G5", n, `${d.relation === "impact" ? "impact on" : "cites"} \`${d.ref}\`, ${d.why}`);
  }

  // G6: no cycles in lineage
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const c of s.nodes[id]?.children ?? []) {
      const k = color.get(c) ?? 0;
      if (k === 1) return true;
      if (k === 0 && visit(c)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const n of nodes) if (!color.get(n.id) && visit(n.id)) {
    v("G6", n, "lineage cycle");
    break;
  }

  // G7: only a fold writes claims or assigns `folded`
  const folded = Object.entries(s.tagIds).find(([, name]) => name === "folded")?.[0];
  for (const c of s.commits) {
    if (c.message.startsWith(FOLD_PREFIX) || c.message.startsWith("governor init") || c.message.startsWith("governor migrate")) continue;
    for (const id of c.nodes) {
      const n = s.nodes[id];
      if ((n?.kind === "state" || n?.kind === "plan") && n.createdIn !== c.id)
        v("G7", n, `changed by a commit that is not a fold: "${c.message.slice(0, 80)}"`);
    }
    if (c.tagged.some((t) => t.tag === folded)) v("G7", null, `\`folded\` assigned outside a fold: "${c.message.slice(0, 80)}"`);
  }

  const t = tail(s).filter((n) => !legacy(n));
  if (t.length >= (opts.foldThreshold ?? 3)) w("tail", null, `${t.length} unfolded record(s) — time to fold`);
  return out;
}
