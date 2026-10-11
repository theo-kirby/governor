import assert from "node:assert/strict";
import test from "node:test";
import { check } from "../lib/check";
import { citations, claimBody, parseImpacts, recordBody } from "../lib/migrate";
import { claimContent, declaresNone, impactContent, mergeCitations, newClaims, parseEdge, recordContent, recordedAt } from "../lib/model";
import { deriveEdges, type GNode, type GraphSnapshot } from "../lib/snapshot";

const node = (id: string, kind: GNode["kind"], extra: Partial<GNode> = {}): GNode => ({
  id, slug: `${id}-x-0001`.replace(/[^a-z-0-9]/g, ""), title: id, summary: "", content: "", seq: 0, createdIn: "c0",
  editedBy: [], live: true, parents: [], children: [], container: "root", tags: kind && kind !== "root" ? [kind] : [],
  kind, status: null, folded: false, at: null, ...extra,
});

function graph(): GraphSnapshot {
  const nodes: Record<string, GNode> = {
    root: node("root", "root", { tags: ["governor"], container: null }),
    comp: node("comp", "state", { parents: ["root"], tags: ["state", "working"], status: "working" }),
    rec: node("rec", "record", { parents: ["root"], content: recordContent("## What\nx", [], "nothing changes", { at: "2026-01-01T00:00:00Z" }) }),
  };
  nodes.root.children = ["comp", "rec"];
  return {
    version: 2, head: "h", repositoryId: "r", root: "root", nodes, tagIds: { t1: "folded" },
    edges: [{ id: "e1", source: "comp", target: "rec", content: "cites\n" }], dangling: [],
    commits: [{ id: "c0", message: "governor init", nodes: ["root", "comp", "rec"], tagged: [] }],
  };
}

test("record content carries the generated sections the checker and the hub read", () => {
  const c = recordContent("## What\n\nx\n", [{ label: "calm-oak-0001", delta: "now  works" }], null, { at: "2026-10-11T00:00:00Z", branch: "main", commit: "abc" });
  assert.equal(recordedAt(c), "2026-10-11T00:00:00Z");
  assert.match(c, /^- calm-oak-0001 — now works$/m);
  assert.ok(!declaresNone(c));
  assert.ok(declaresNone(recordContent("## What", [], "docs only", { at: "t" })));
  assert.deepEqual(newClaims(recordContent("## What", [{ label: "NEW engine-speed", delta: "measured" }], null, { at: "t" })), [{ name: "engine-speed", delta: "measured" }]);
});

test("edge contents parse back to their relation", () => {
  assert.equal(parseEdge(impactContent(["a", "b"])).relation, "impact");
  assert.equal(parseEdge(impactContent(["a", "b"])).lines.length, 2);
  assert.equal(parseEdge("cites\n").relation, "cites");
  assert.equal(parseEdge("cites: because\n").lines[0].text, "because");
});

test("a clean graph checks clean", () => {
  assert.deepEqual(check(graph()).filter((f) => f.level === "violation"), []);
});

test("check catches an edited record, a missing impact, a bad edge and an out-of-fold state change", () => {
  const s = graph();
  s.nodes.rec.editedBy = ["manual edit"];
  s.nodes.r2 = node("r2", "record", { parents: ["root"], content: "## What\nno impact section" });
  s.edges.push({ id: "e2", source: "rec", target: "r2", content: "cites" });
  s.commits.push({ id: "c1", message: "manual", nodes: ["comp"], tagged: [] });
  const rules = check(s).filter((f) => f.level === "violation").map((f) => f.rule).sort();
  assert.deepEqual(rules, ["G2", "G3", "G5", "G7"]);
});

test("check wants exactly one status and evidence for a working claim", () => {
  const s = graph();
  s.nodes.claim = node("claim", "state", { parents: ["comp"], tags: ["state", "working", "open"], status: "working" });
  s.nodes.claim2 = node("claim2", "state", { parents: ["comp"], tags: ["state", "working"], status: "working" });
  const found = check(s).filter((f) => f.rule === "G4").map((f) => f.node);
  assert.equal(found.length, 3); // two statuses; and two claims citing nothing
});

test("the hypergraph parsers read impacts, statuses and citations", () => {
  const rec = "## What\nx\n\n## State Impact\n\n- calm-oak-0001 — a delta\n- NEW engine-speed — measured\n- plan/brave-fox-0002 — bet\n";
  assert.deepEqual(parseImpacts(rec).map((i) => [i.view, i.target, i.isNew]), [["state", "calm-oak-0001", false], ["state", "engine-speed", true], ["plan", "brave-fox-0002", false]]);
  assert.deepEqual(claimBody("Status: working\n\n## Current\n\nx\n"), ["working", "## Current\n\nx\n"]);
  const claim = "## Current\n\n- y [rec: calm-oak-0001]\n\n## Provenance\n\n- brave-fox-0002 — why it matters\n- calm-oak-0001 — dup\n";
  assert.deepEqual(citations(claim), [{ slug: "brave-fox-0002", why: "why it matters" }, { slug: "calm-oak-0001", why: "dup" }]);
  const body = recordBody({ node_id: "n", slug_name: "s", title: "t", summary: "", parent_ids: [], created_at: "2026-01-02T03:04:05+00:00", content: rec });
  assert.equal(recordedAt(body), "2026-01-02T03:04:05+00:00");
  assert.ok(body.indexOf("## Recorded") < body.indexOf("## State Impact"));
});

test("relations come from content: impact lines, evidence lists and [rec:] mentions", () => {
  const nodes: Record<string, GNode> = {
    claim: node("claim", "state", { slug: "calm-oak-0001", content: claimContent("- fast [rec: brave-fox-0002]", "", [{ slug: "quiet-elk-0003", why: "measured" }, { slug: "lost-one-0009", why: "" }]) }),
    rec: node("rec", "record", { slug: "brave-fox-0002", content: recordContent("## What", [{ label: "calm-oak-0001", delta: "a" }, { label: "calm-oak-0001", delta: "b" }, { label: "NEW thing", delta: "c" }, { label: "quiet-elk-0003", delta: "d" }], null, { at: "t" }) }),
    rec2: node("rec2", "record", { slug: "quiet-elk-0003" }),
  };
  const { edges, dangling } = deriveEdges(nodes);
  const impact = edges.find((e) => e.source === "rec" && e.target === "claim")!;
  assert.deepEqual(parseEdge(impact.content).lines.map((l) => l.text), ["a", "b"]);
  assert.deepEqual(edges.filter((e) => e.source === "claim").map((e) => [e.target, parseEdge(e.content).lines[0]?.text ?? ""]).sort(), [["rec", ""], ["rec2", "measured"]]);
  assert.deepEqual(dangling.map((d) => [d.relation, d.ref]).sort(), [["cites", "lost-one-0009"], ["impact", "quiet-elk-0003"]]);
  assert.deepEqual(mergeCitations([{ slug: "a-b-0001", why: "" }], [{ slug: "a-b-0001", why: "y" }, { slug: "c-d-0002", why: "" }]), [{ slug: "a-b-0001", why: "y" }, { slug: "c-d-0002", why: "" }]);
});
