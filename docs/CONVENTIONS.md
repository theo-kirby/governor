# Governor conventions — v1

A project's research memory is **one Flywheel graph** in the project's local repository
(`.flywheel/` at the checkout root, pushed and pulled through a hosted Flywheel repository).
Governor adds a discipline on top of it; it never keeps data of its own.

The discipline:

- **Records** are an append-only log of what happened: experiments, fixes, decisions,
  dead ends. A dead end recorded is worth as much as a success.
- **State** is a small, single-writer distillation of what is true *now*: the
  architecture, what works, what is open or broken, and what was learned the hard way.
- Every state claim **cites** the records it rests on, and every record **declares** what
  it changes in state. A fresh agent reads state first and the record log only to dig.

One graph holds records and state. Statuses are Flywheel tags, and there are no
files. Impacts and citations are slug lines in node content; governor derives the edges
from them (see "Why relations are content").

## The graph

```
                       root  (tag: governor)
          ┌─────────────┴──────────────┐
     state tree                   record history
  (lineage: architecture)      (lineage: causality)
          ▲      cites ─────────────────▶ │
          └───────────── impacts ◀────────┘
```

| Element | Flywheel construct |
|---|---|
| The project | one **root** node, tagged `governor`. It is the tag scope for everything below. |
| Membership | every node is **contained** in the root (flat). |
| Kind | exactly one tag: `record` or `state` (or the legacy `plan`, see below). |
| State tree | **lineage** among state nodes. Top-level components are children of the root. A claim's parent is the component it belongs to. |
| Record history | **lineage** among records, meaning "this followed from that result". The project's first records are children of the root. Several parents are fine. |
| Status | exactly one tag on each state or plan node: `open`, `working`, `broken`, `blocked` or `superseded`. Governor enforces "exactly one"; Flywheel does not. |
| Folded | the tag `folded` on a record whose impacts a fold has applied. Unfolded records are the **tail**. |
| Impact | a `- <claim-slug> — <delta>` line in the record's generated `## State Impact` (record → claim). A claim that does not exist yet is `- NEW <kebab-name> — <delta>`, which the fold turns into a claim. |
| Citation | a `- <record-slug>` or `- <record-slug> — <why>` line in the claim's `## Evidence`, written by a fold (claim → record), plus any `[rec: slug]` mention in the claim's text. Imported claims may carry a `## Provenance` list instead; it reads the same. |

`governor snapshot` derives one edge per (record, claim) impact pair, with one `impact:`
line per delta, and one per (claim, record) citation, with `cites` or `cites: <why>`. The
viewer, `check` and tools read those edges. A line that names no node of the right kind
is a dangling reference.

### Why relations are content

Flywheel 0.2.78 has real edges, and governor first used them. But a local repository
re-validates every semantic edge on every staged operation, each with a recursive
containment query, so on a graph with ~3,000 relations every write took minutes. Lines in
content cost nothing to write, are readable without the graph, and are what records and
claims carried anyway. If Flywheel validates edges incrementally, a one-off migration can
turn the lines into edges without changing the model.

## Node bodies

Bodies are markdown in the node's `content`. Governor writes the headings, and the agent
writes what goes under them.

- **Record**: `## What`, `## Why`, `## Method`, `## Result`, then a generated
  `## Repo` (repo, branch, commit, when code is involved) and a generated
  `## State Impact` listing the impacts, or `none: <reason>`. These lines are the
  impacts.
- **State**: `## Current` (what is true now; every bullet ends with the record slugs it
  rests on, `[rec: slug]`) and `## Negative knowledge` (what was tried and does not work,
  and why), then a generated `## Evidence` list of the records it cites. Citations
  accumulate: a fold keeps the claim's evidence and adds to it.
- **Plan** (legacy): a state-shaped kind that an earlier planner role wrote, one node per
  horizon. No role writes plan claims now. Graphs that still hold them stay valid: `check` reads a plan claim like a state claim, and
  `governor render --view plan` still renders them. Do not add new ones.

Slugs (`adjective-noun-####`) are Flywheel's own `slug_name`, minted on create, and are
how anyone refers to a node in prose.

## The rules (what `governor check` enforces)

| # | Rule |
|---|---|
| G1 | One root tagged `governor`. Every other node is contained in it and carries exactly one kind tag. |
| G2 | Records are append-only. After a record's creating commit, no commit sets its fields. Corrections are new child records. |
| G3 | Every record declares its impact: at least one impact or `NEW` line, or a `none:` line in `## State Impact`. |
| G4 | Every state or plan node except a component carries exactly one status tag and cites at least one record. `working`, `broken` and `blocked` claims cite evidence. |
| G5 | Relations resolve and run the right way. An impact names a state or plan claim; a citation names a record. (Imported text that dangles is a warning.) |
| G6 | Lineage stays within a kind. Record parents are records or the root, and state parents are state or the root. There are no cycles. |
| G7 | Only a fold writes state. Every commit that touches a state node, or assigns `folded`, has a message starting `governor fold`. |

Warnings that do not fail the check:
- the tail is longer than the fold threshold (default 3);
- a claim is `working` but rests only on records older than the newest record that touches it;
- a record parent was chosen by recency instead of causality (detected when the parent is
  simply the previous record of the same session; advisory only).

Imported records are the records written by commits whose message starts `governor migrate`
(a graph imported from an older memory by an importer that governor no longer ships). They predate the impact lines, so G3 skips them,
the tail warning does not count them, and a G5 dangling reference in them is a warning.

## Roles

- **Contributors** (any agent, any worktree) write records and nothing else:
  `governor record`.
- **The folder** (one at a time, on the default branch) applies the tail.
  `governor fold` lists the tail with its impacts. The agent rewrites the claims; then
  `governor fold --apply` writes the bodies, statuses and citations and tags the records
  `folded`, in one commit. A fold may create a component (`"component": true`, no
  status) to group claims.
- **Readers** run `governor orient` (frontier, tail, and recent records),
  `governor render` (writes `STATE.md`), or
  `governor viz` (the hub view). Tools use `governor head` as a cache key and `--json`
  on `record`, `fold --apply` and `check`.

## Concurrency

A Flywheel repository has one staging area. Governor serializes its own writes with a
lock in the main checkout, so every git worktree shares it, and it refuses to commit over
staged work it did not stage. A fold also takes a fold lock, which keeps the
single-writer rule mechanical rather than a matter of manners.

## Reading fast

A snapshot replays the repository log: one paginated call returns every operation with
each node's initial values. Then `node:get` runs only for nodes whose fields changed after
creation, which is state, never records. On a graph of 1,135 nodes the log is 0.5 s.
Snapshots are cached by head.
