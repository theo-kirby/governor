# Governor conventions — v1

A project's research memory is **one Flywheel graph** in the project's local repository
(`.flywheel/` at the checkout root, pushed and pulled through a hosted Flywheel repository).
Governor adds a discipline on top of it; it never keeps data of its own.

The discipline is Hypergraph's, kept where it earned its place:

- **Records** are an append-only log of what happened: experiments, fixes, decisions,
  dead ends. A dead end recorded is worth as much as a success.
- **State** is a small, single-writer distillation of what is true *now*: the
  architecture, what works, what is open or broken, and what was learned the hard way.
- Every state claim **cites** the records it rests on, and every record **declares** what
  it changes in state. A fresh agent reads state first and the record log only to dig.

What changes from Hypergraph: one graph instead of two, real Flywheel edges instead of
slugs inside markdown, Flywheel tags instead of `Status:` lines, and no files.

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
| The project | one **root** node, tagged `governor`. It is the tag scope and the edge graph for everything below. |
| Membership | every node is **contained** in the root (flat). Flywheel only draws edges between descendants of one container. |
| Kind | exactly one tag: `record`, `state`, or `plan`. |
| State tree | **lineage** among state nodes. Top-level components are children of the root. A claim's parent is the component it belongs to. |
| Record history | **lineage** among records, meaning "this followed from that result". The project's first records are children of the root. Several parents are fine. |
| Status | exactly one tag on each state or plan node: `open`, `working`, `broken`, `blocked` or `superseded`. Governor enforces "exactly one"; Flywheel does not. |
| Folded | the tag `folded` on a record whose impacts a fold has applied. Unfolded records are the **tail**. |
| Impact | an **edge record → state** whose content lines are the declared deltas, `impact: <delta>`. A claim that does not exist yet has no node to point at, so it is a `- NEW <kebab-name> — <delta>` line in the record's generated `## State Impact`, which the fold turns into a claim. Flywheel edges join two nodes inside the root, never the root itself. |
| Citation | an **edge state → record**, written by a fold, content `cites`. A claim's citations are its provenance. |

Flywheel allows one edge per ordered pair in a graph, so a record's several deltas to one
claim are several lines of one edge. A record → claim impact and a claim → record citation
are different pairs, so they coexist.

## Node bodies

Bodies are markdown in the node's `content`. Governor writes the headings, and the agent
writes what goes under them.

- **Record**: `## What`, `## Why`, `## Method`, `## Result`, then a generated
  `## Repo` (repo, branch, commit, when code is involved) and a generated
  `## State Impact` listing the impacts as prose, or `none: <reason>`. The edges are the
  machine truth. The section is there so a reader never needs the graph to understand a
  record.
- **State**: `## Current` (what is true now; every bullet ends with the record slugs it
  rests on, `[rec: slug]`) and `## Negative knowledge` (what was tried and does not work,
  and why). The citations are edges; the slugs in the text are for readers.
- **Plan** (optional, Ouroboros's bets): a state-shaped node per horizon (`short`,
  `medium`, `long`), single-writer like state. Its writer is the planner.

Slugs (`adjective-noun-####`) are Flywheel's own `slug_name`, minted on create, and are
how anyone refers to a node in prose.

## The rules (what `governor check` enforces)

| # | Rule |
|---|---|
| G1 | One root tagged `governor`. Every other node is contained in it and carries exactly one kind tag. |
| G2 | Records are append-only. After a record's creating commit, no commit sets its fields. Corrections are new child records. |
| G3 | Every record declares its impact: at least one impact edge, or a `none:` line in `## State Impact`. |
| G4 | Every state or plan node except a component carries exactly one status tag and cites at least one record. `working`, `broken` and `blocked` claims cite evidence. |
| G5 | Edges run the right way. Impacts go record → state or plan. Citations go state or plan → record. |
| G6 | Lineage stays within a kind. Record parents are records or the root, and state parents are state or the root. There are no cycles. |
| G7 | Only a fold writes state. Every commit that touches a state node, or assigns `folded`, has a message starting `governor fold`. |

Warnings that do not fail the check:
- the tail is longer than the fold threshold (default 3);
- a claim is `working` but rests only on records older than the newest record that touches it;
- a record parent was chosen by recency instead of causality (detected when the parent is
  simply the previous record of the same session; advisory only).

## Roles

- **Contributors** (any agent, any worktree) write records and nothing else:
  `governor record`.
- **The folder** (one at a time, on the default branch) applies the tail.
  `governor fold` lists the tail with its impacts. The agent rewrites the claims; then
  `governor fold --apply` writes the bodies, statuses and citations and tags the records
  `folded`, in one commit. A fold may create a component (`"component": true`, no
  status) to group claims.
- **The planner** writes plan claims the same way: a fold with `"view": "plan"` writes
  `plan`-kind claims under a plan component, usually with `"folded": []` so the state
  folder still owns the tail. Its commit reads `governor fold (plan): …`.
- **Readers** run `governor orient` (frontier, tail, and recent records),
  `governor render` (writes `STATE.md`; `--view plan` writes the plan), or
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
creation, which is state, never records. On Cadex's 1,135 nodes the log is 0.5 s.
Snapshots are cached by head.
