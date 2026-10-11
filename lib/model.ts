// The governor model (docs/CONVENTIONS.md) as data: tag names, statuses, the relation
// grammar, body templates. Nothing here talks to Flywheel.
//
// Relations live in node content, not in Flywheel edges: a record's generated
// `## State Impact` lines are its impacts, and a claim's `## Evidence` list (plus any
// `[rec: slug]` mention) is its citations. The snapshot derives edges from them.
// Flywheel 0.2.78 re-validates every semantic edge on every staged operation, which makes
// a graph with thousands of edges unwritable.

export const ROOT_TAG = "governor";
export const KINDS = ["record", "state", "plan"] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ["open", "working", "broken", "blocked", "superseded"] as const;
export type Status = (typeof STATUSES)[number];
export const FOLDED = "folded";
export const FOLD_PREFIX = "governor fold";
export const RECORD_PREFIX = "governor record";

export const TAG_STYLE: Record<string, { bg: string; fg: string }> = {
  governor: { bg: "#ffffff", fg: "#000000" },
  record: { bg: "#6b7a8f", fg: "#ffffff" },
  state: { bg: "#9aa7b7", fg: "#000000" },
  plan: { bg: "#7f8fa6", fg: "#ffffff" },
  open: { bg: "#d8a657", fg: "#000000" },
  working: { bg: "#89b482", fg: "#000000" },
  broken: { bg: "#ea6962", fg: "#000000" },
  blocked: { bg: "#c397d8", fg: "#000000" },
  superseded: { bg: "#5a5f66", fg: "#ffffff" },
  folded: { bg: "#3c4048", fg: "#ffffff" },
};
export const ALL_TAGS = [ROOT_TAG, ...KINDS, ...STATUSES, FOLDED];

export const SLUG_RE = /^[a-z]+-[a-z]+-\d{4}$/;
export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One declared delta. `target` is a node id, or null for a claim that does not exist yet. */
export type Impact = { target: string | null; name?: string; delta: string };

/** Edge content for record → claim: one `impact:` line per delta. */
export function impactContent(deltas: string[]): string {
  return deltas.map((d) => `impact: ${oneLine(d)}`).join("\n") + "\n";
}
/** The `NEW <name> — <delta>` lines of a record's generated `## State Impact`. */
export function newClaims(content: string): { name: string; delta: string }[] {
  const sec = content.split(/^## State Impact\s*$/m)[1] ?? "";
  return [...sec.matchAll(/^- NEW ([a-z0-9-]+) — (.*)$/gm)].map((m) => ({ name: m[1], delta: m[2].trim() }));
}
export function parseEdge(content: string | null | undefined): {
  relation: "impact" | "new" | "cites" | "other";
  lines: { name?: string; text: string }[];
} {
  const lines = (content ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => l.startsWith("impact:")))
    return { relation: "impact", lines: lines.map((l) => ({ text: l.slice(7).trim() })) };
  if (lines.length && lines.every((l) => /^new [a-z0-9-]+:/.test(l)))
    return {
      relation: "new",
      lines: lines.map((l) => {
        const m = l.match(/^new ([a-z0-9-]+):\s*(.*)$/)!;
        return { name: m[1], text: m[2] };
      }),
    };
  if (lines[0] === "cites" || lines[0]?.startsWith("cites:"))
    return { relation: "cites", lines: lines.map((l) => ({ text: l.replace(/^cites:?\s*/, "") })) };
  return { relation: "other", lines: lines.map((text) => ({ text })) };
}
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export type RecordedContext = { at: string; repo?: string; branch?: string; commit?: string };

/** A record's full content: the agent's sections, then the generated ones. */
export function recordContent(
  body: string,
  impacts: { label: string; delta: string }[],
  none: string | null,
  ctx: RecordedContext,
): string {
  const lines = [body.trimEnd(), "", "## Recorded", "", `- at: ${ctx.at}`];
  if (ctx.repo) lines.push(`- repo: ${ctx.repo}`);
  if (ctx.branch) lines.push(`- branch: ${ctx.branch}`);
  if (ctx.commit) lines.push(`- commit: ${ctx.commit}`);
  lines.push("", "## State Impact", "");
  if (none !== null) lines.push(`none: ${oneLine(none)}`);
  else for (const i of impacts) lines.push(`- ${i.label} — ${oneLine(i.delta)}`);
  return lines.join("\n") + "\n";
}

export function recordedAt(content: string): string | null {
  return content.match(/^## Recorded\s*\n(?:\s*\n)*- at: (\S+)/m)?.[1] ?? null;
}
export function declaresNone(content: string): boolean {
  const section = content.split(/^## State Impact\s*$/m)[1] ?? "";
  return /^none:\s*\S/m.test(section);
}

export type Citation = { slug: string; why: string };

/** A claim's full content: its two prose sections and its evidence list. */
export function claimContent(current: string, negative: string, evidence: Citation[] = []): string {
  const ev = evidence.map((c) => `- ${c.slug}${c.why ? ` — ${oneLine(c.why)}` : ""}`);
  return [
    "## Current", "", current.trim() || "_(nothing yet)_", "",
    "## Negative knowledge", "", negative.trim() || "_(none recorded)_", "",
    "## Evidence", "", ...(ev.length ? ev : ["_(none yet)_"]), "",
  ].join("\n");
}

/** The text under `## heading` (case-insensitive), or null. */
export function sectionOf(content: string, heading: string): string | null {
  const m = new RegExp(`^## ${heading}\\s*$`, "im").exec(content);
  if (!m) return null;
  const rest = content.slice(m.index + m[0].length);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

const SLUG_IN = /([a-z]+-[a-z]+-\d{4})/;
/** A claim's citations: its `## Evidence` (or legacy `## Provenance`) list, then `[rec: slug]` mentions. */
export function citations(content: string): Citation[] {
  const out = new Map<string, string>();
  for (const h of ["Evidence", "Provenance"])
    for (const raw of (sectionOf(content, h) ?? "").split("\n")) {
      const m = raw.trim().match(/^-\s*`?([a-z]+-[a-z]+-\d{4})`?\s*(?:—\s*(.*))?$/);
      if (m && !out.has(m[1])) out.set(m[1], (m[2] ?? "").trim());
    }
  for (const m of content.matchAll(/\[rec:\s*([a-z]+-[a-z]+-\d{4})\s*\]/g)) if (!out.has(m[1])) out.set(m[1], "");
  return [...out].map(([slug, why]) => ({ slug, why }));
}

/** Union of citation lists, first reason wins. */
export function mergeCitations(...lists: Citation[][]): Citation[] {
  const out = new Map<string, string>();
  for (const l of lists) for (const c of l) if (!out.has(c.slug) || (!out.get(c.slug) && c.why)) out.set(c.slug, c.why);
  return [...out].map(([slug, why]) => ({ slug, why }));
}

export type ImpactLine = { view: string; target: string; delta: string; isNew: boolean };
/** A record's `## State Impact` lines: `- <slug> — delta`, `- NEW <name> — delta`, optional `plan/` prefix. */
export function parseImpacts(content: string): ImpactLine[] {
  const out: ImpactLine[] = [];
  for (const raw of (sectionOf(content, "State Impact") ?? "").split("\n")) {
    const m = raw.trim().match(/^-\s*(?<target>.+?)\s+—\s+(?<delta>.+)$/);
    if (!m) continue;
    // Hypergraph wrote `- target: <slug> — delta`; governor writes `- <slug> — delta`
    let target = m.groups!.target.trim().replace(/^target:\s*/, "").replace(/^`|`$/g, "");
    let view = "state";
    if (target.includes("/")) [view, target] = [target.slice(0, target.indexOf("/")), target.slice(target.indexOf("/") + 1).trim()];
    const isNew = /^NEW\s+/.test(target);
    target = target.replace(/^NEW\s+/, "").replace(/^`|`$/g, "");
    if (!isNew && !SLUG_IN.test(target)) continue;
    out.push({ view, target, delta: m.groups!.delta.trim(), isNew });
  }
  return out;
}
export function section(content: string, heading: string): string {
  const parts = content.split(/^## /m);
  const hit = parts.find((p) => p.startsWith(heading + "\n") || p.startsWith(heading + "\r\n"));
  return hit ? hit.slice(heading.length).trim() : "";
}

export const RECORD_SECTIONS = ["## What", "## Why", "## Method", "## Result"];
export const GENERATED_SECTIONS = ["## Recorded", "## State Impact"];
