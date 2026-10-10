# flywheel-viz

A local, read-only Flywheel graph on a black screen. Nothing surrounds the graph:
no logo, sidebar, toolbar, inspector, search, legend, or visible status messages.
An optional `?debug` mode adds a compact control panel for synthetic stress tests.
Circular nodes, labels, and edges use only white and shades of gray. Labels sit
below the circles; containers use slightly larger circles.

React + TypeScript + Vite provide the app shell. A radial layout places the
root at the center and containment descendants on outward rings. Cytoscape.js
draws curved edges and handles pan, zoom, and selection. A loopback-only Fastify API reads the
installed Flywheel CLI or reads legacy Hypergraph Markdown files directly.
Only synthetic demo data is stored in this project.

## Demo template

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173/?demo** for the synthetic visual template:
**16 nodes and 21 relationships** (15 containment links and 6 semantic edges).
It contains a Research root, Record / State / Reference containers, and short
example research chains. The whole demo uses the same circles, radial layout,
and gestures as a real graph, with no extra interface.

`?demo` takes precedence over every repository setting and makes no API or
Flywheel calls. It never changes the remembered repository path. A fresh viewer
with no configured or remembered repository also opens the demo automatically.
For the production server, use **http://127.0.0.1:4311/?demo**.

Edit **`src/demo.ts`** to reuse it as a template:

- `nodeDefinitions`: stable ID, display title, and parent ID (`null` for roots).
- `semanticDefinitions`: scope container ID, source ID, and target ID.

Containment edges and child/edge counts are derived automatically. Keep IDs
unique, use existing endpoints, and keep a semantic edge's endpoints inside
its scope. All sample names and relationships are invented; no lab data is used.

## Legacy Hypergraph repositories (Cadex)

Open **http://127.0.0.1:5173/?repo=../cadex**. The same `repo` parameter accepts
repository roots or their `.hypergraph` directories. Add `&view=state` (or
`record` / `plan`) to show one graph, and `&citations=0` for parent links only.
For example: **http://127.0.0.1:4311/?repo=../cadex&view=state&citations=0**.
Filtered views include only edges whose endpoints are both visible.
No Hypergraph CLI, export,
migration, or writes to the source repository are needed. If both formats exist,
`.flywheel/db.sqlite` takes precedence.

The adapter reads the working tree, including uncommitted edits, from `graph_dir`
in `.hypergraph/config.yml` (default `.hypergraph/graph`). Each Markdown file
must have YAML frontmatter with `node_id`, `slug`, `title`, and optional `parents`.
Graph subdirectories distinguish record, state, plan, and other named views.
All parent links are retained, including multiple parents. Parent links determine
the radial spanning forest; citations do not move nodes between branches.
Explicit `[rec: slug]`, `[state: slug]`, and `[plan: slug]` references become
citation edges pointing from the citing node to the referenced node. Repeated
citations to the same node are deduplicated. Arbitrary prose links are not parsed.
Graph names and `Status:` lines become grayscale node tags. Markdown bodies
are neither rendered nor returned to the browser.

Missing parents, duplicate identifiers, invalid YAML, and symlinked graph files
produce an error. Unresolved citations are omitted with a console warning.
File lists and modification metadata are rechecked before returning; detected
concurrent edits require a refresh. This is a best-effort working-tree read,
not a transactional or committed snapshot. There is a 10,000-node / 2 MB-per-node
read limit. Paths must stay within the selected repository.

Cadex was checked with 1,120 nodes and 3,671 relationships (1,140 parent links
and 2,531 citations). Large graphs start near a root at a readable scale. Press
**F** for the full overview, then pan and zoom to explore. Citations are real
cross-links and can make the overview dense; none are silently hidden.

## Debug playground

Open **http://127.0.0.1:5173/?debug** (or port 4311 for the production server).
The panel offers 13 shapes: the research demo, balanced tree, deep chain, wide
star, lopsided tree, repeated merges, directed cycle, disconnected islands,
dense graph, seeded random structure, loops/parallel edges, a single node, and an empty graph.

- Set **Nodes** (2–200) and **Branches / islands** where applicable. The demo,
  single-node, and empty presets have fixed sizes.
- **Random structure** mixes uneven containment branches, disconnected roots, and
  optional cross-links. **Add cross-links** is off by default; enable it to stress
  non-tree relationships. **Seed** reproduces its topology; **Link density** controls the extra
  cross-links (up to roughly four per node at maximum density).
- Dense graphs are limited to 60 nodes. **Link density** and **Seed** generate
  reproducible cross-links; **Next seed** produces a different case.
- **Ring distance**, **Node spacing**, **Curve strength**, and **Show labels**
  change the rendering live. Spacing is a minimum: crowded levels expand all rings together.
- **Show tags** toggles tag annotations. **Tagged fraction** controls synthetic tag
  coverage; **Spotlight tag** dims nonmatching nodes without changing topology.
  Tag coverage uses a separate seeded stream, so changing it preserves the edges.
- **Fit graph** restores the overview. **Reset** restores the reference demo
  and default controls. The minus button collapses the panel.
- Node/edge counts and layout computation time help compare cases. Timing
  measures positioning only, not canvas rendering or frame rate.
- Every setting is stored in the URL; **Copy link** captures a reproducible case.
  Refreshing keeps the same graph and settings.

Debug mode takes precedence over `repo` and `demo`, makes no API/CLI requests,
and never changes the remembered repository. Its tuning does not affect the
normal demo or live repository views. It always starts with the full graph fitted.
The generated graphs deliberately include structures that may not be valid
Flywheel repositories. Loops, duplicate links, and dense crossings are useful
stress cases; overlapping edges are not automatically separated.

Edit `src/debug-graphs.ts` to add a preset. Use an explicit seed for any randomness,
unique node/edge IDs, and existing endpoints so the URL reproduces the same case.

## Run with a local repository

Requires Node.js 22.12+. The demo does not require Flywheel. For a real repository,
install the Flywheel CLI. The adapter is tested against
Flywheel 0.2.78. `~/.local/bin` is included in the executable search path;
set `FLYWHEEL_BIN` to an absolute path if needed.

```sh
npm install
FLYWHEEL_REPO=../lab npm run dev
```

Open **http://127.0.0.1:5173**. The graph loads automatically.
The API listens on `127.0.0.1:4311`; both ports must be available.

Repository selection happens without an on-screen picker, in this order:

1. The URL's `repo` query parameter, for example
   **http://127.0.0.1:5173/?repo=../lab**.
2. The server's `FLYWHEEL_REPO` environment variable.
3. The last successfully opened repository path in this browser's local storage.
4. The synthetic demo if none of the above is set.

Paths may point at a repository root or its `.flywheel` directory. Absolute
paths, `~/…`, and paths relative to the server's working directory are accepted.
`../lab` is a development example, not a hardcoded default.

For a production build served from a single local port:

```sh
npm run build
FLYWHEEL_REPO=../lab npm start
```

Open **http://127.0.0.1:4311**. Stop the dev server first if it is using port 4311.
Keep dev dependencies installed: the local server uses the TypeScript runtime.

## Graph interaction

- Drag the background to pan; scroll or pinch to zoom.
- Click a node to select it. Selection adds a white border without opening UI.
- Tab to focus the canvas. Arrow keys pan, `+` / `-` zoom, and `F` or `0` fit
  the entire graph. These controls have no on-screen buttons.
- Reload the browser to read the latest committed state and recompute the radial layout.

All live nodes are included, including disconnected nodes. Containment edges
are dashed dark gray; semantic edges are solid light gray. Arrowheads indicate
direction. Edges bow away from the radial center along quadratic Bézier curves.
The bend is determined geometrically for each edge, independently of its direction
or relationship type. Spokes through the center stay straight. Containment defines
the rings; semantic edges connect nodes without changing their placement.
Each subtree keeps a contiguous angular sector across all depths, with parents
centered over their descendants. Sparse rings keep gaps where branches end;
nodes are not independently redistributed around each ring. All rings share a
consistent radial step, expanded together when necessary for label spacing.
This favors readable parent-child branches over perfectly even ring occupancy.
Single-node levels keep their branch direction, so deep chains remain spokes.
Disconnected components use an implied center with their roots on the first
ring; no extra node or relationship is created. Cycles and multiple parents are
reduced to a spanning forest for positioning only; every original edge is still
drawn. Semantic-only graphs use their directed edges to determine the rings.
Cross-links can still cross other branches; random fixtures generate them only
when **Add cross-links** is enabled. Live repository relationships remain visible.
Long titles are shortened on the canvas, and labels disappear at distant zoom
levels. Large graphs open at a readable scale around the first containment root when a
full fit would make the nodes too small. All nodes remain on the canvas; pan
to explore, or press `F` for the full overview. Resizing preserves the camera.

Loading, empty repositories, and failed reads leave the
screen black. Failures are reported in the browser console; accessible labels
identify loading and error states. There are no error banners or loading overlays.

For real repositories, the viewer shows committed topology only. It does not display staging, node
bodies, Markdown, citations, search results, or a selected-node neighborhood.
UUID mentions in content are never inferred as graph edges. There is no graph
editing, automatic polling, hosted service, or external synchronization.

## Tagged nodes

Nodes can carry `tags: [{ id, name, scope? }]`. Tags appear below the title as
`#active · #review`, with a `+N` suffix when there are more than two. Long names
are shortened on the canvas. Tagged nodes have a heavier grayscale outline.
Tag labels stay independent of the title-visibility toggle in debug mode.

The reference demo includes fixed tags; edit `demoTags` in `src/demo.ts` to
change them. Other debug presets generate zero, one, or two tags per node from
`active`, `review`, `blocked`, and `reference`. Tag visibility, coverage, and
spotlight selection are saved in the debug URL.

For live repositories, the adapter reads committed tags with `repo:tag:list`,
including pagination and head guards. Only active definitions on live holders
are shown. Scope and tag ID remain distinct even when display names match.
Tag colors from Flywheel are intentionally rendered in grayscale.

Flywheel exposes tags per scope, and any node can be a scope, so the first read
of a commit scans all node scopes with at most four CLI processes at once.
The graph opens first; a background request loads tags for that same commit,
preserving zoom, pan, and selection. On large repositories this scan can take
tens of seconds. If it fails or the commit changes, the graph remains visible
and the console reports the error. Tag results
are cached in memory for up to four repository/commit pairs; changing commits
causes a fresh scan. The viewer does not create, assign, rename, or retire tags.

## Architecture

- `server/hypergraph.ts`: read-only legacy Markdown/YAML adapter and citation resolution.
- `server/adapter.ts`: allowlisted local CLI reads, JSON validation, pagination,
  and commit-head consistency guards. Node-list parent IDs supply containment;
  scopes with nonzero edge counts are read with `repo:edge:list`. Active tag
  definitions and holders are read with `repo:tag:list`.
- `server/app.ts`: `/api/config` and `/api/graph`, validated paths, local host and
  origin checks, and a required custom request header. No CORS or write routes.
- `shared/types.ts`: normalized graph types.
- `src/App.tsx`: demo selection or automatic repository resolution, topology loading, and background tag enrichment.
- `src/demo.ts`: editable synthetic graph template, independent of the API.
- `src/debug-graphs.ts`: deterministic stress generators and bounded URL settings.
- `src/DebugView.tsx`: debug-only preset and live tuning controls.
- `src/layout.ts`: Radial geometry for all nodes, with space reserved for circular nodes and their labels.
- `src/GraphCanvas.tsx`: grayscale canvas rendering and pointer/keyboard gestures.
- `src/edge-curves.ts`: outward Bézier bend direction for each pair of endpoints.
- `src/node-label.ts`: bounded title/tag annotation formatting.
- `src/styles.css`: black, full-viewport presentation.
- `tests/`: synthetic adapter, API, radial-layout, and browser tests.

Every paginated read is guarded with `at_head`, and status is checked again
after loading. A changed commit head fails the read instead of mixing commits;
reload to try again. Snapshot data stays in memory. Only the last repository
path is saved in local storage. The app does not access SQLite directly.

## Development and checks

```sh
npm run check          # Adapter/API/layout tests, TypeScript, production build
npx playwright install chromium
npm run test:ui        # Synthetic browser tests; starts dev server if needed
npm run format        # Format source, configuration, and README
```

`PLAYWRIGHT_EXECUTABLE_PATH` can point at an existing Chromium executable.
Browser tests check automatic loading, the absence of interface elements,
grayscale canvas pixels, keyboard zoom, narrow viewports, failures, demo isolation, and debug controls/URL replay.
All automated fixtures are synthetic. Use `../lab/.flywheel` for manual local
checks; do not save its data or screenshots in Git.

## Privacy and source graph

- Serve on loopback only. No hosting, graph upload, or external sync.
- Keep databases, backups, graph exports, credentials, screenshots, and real-data
  fixtures out of Git, including in this private repository.
- Render titles as canvas text, never HTML. No node-body requests, Markdown
  rendering, remote images, remote fonts, or external assets are needed.
- The production server sets a restrictive content security policy. The API
  does not log graph content or repository paths.
- Graph writes, reconciliation, commits, and backups stay in the existing
  Flywheel CLI workflow. Never edit graph tables or copy a live SQLite database.

The local development graph is `~/lab/.flywheel/` on Air (`mba`). Air is its sole
writer. Lab uses immutable evidence records and mutable state handoffs;
state-to-record citations are not automatically causal edges. Lab workflow
references are `~/lab/docs/FLYWHEEL.md` and `~/lab/STATE.md`.

## Background

This is an independent viewer for the official Flywheel repository format,
separate from Paradigma's UI and the archived `flywheel-local` implementation.
It was started after the installed npm CLI 0.2.78's `flywheel ui` failed with
`ui_web_files_missing` on 2026-10-09. The viewer source lives in the private
`theo-kirby/flywheel-viz` repository; the local research graph stays Git-ignored.

- [Flywheel installation](https://docs.flywheel.paradigma.inc/install)
- [Flywheel repository model](https://docs.flywheel.paradigma.inc/concepts/repos)
- [Flywheel CLI reference](https://docs.flywheel.paradigma.inc/cli)
- [Cytoscape.js renderer](https://js.cytoscape.org/)

Browser tests can target an existing production viewer with `VIEWER_URL=http://127.0.0.1:4311 npm run test:ui` when port 5173 is occupied.
