# flywheel-viz

A local, read-only Flywheel graph viewer. The default radial view is a black screen. Nothing surrounds that view:
no logo, sidebar, toolbar, inspector, search, legend, or visible status messages.
An optional `?debug` mode adds a compact control panel for synthetic stress tests.
Circular nodes, labels, and edges use only white and shades of gray. Labels sit
below the circles; containers use slightly larger circles.

React + TypeScript + Vite provide the app shell. A radial layout places the
root at the center and containment descendants on outward rings. Cytoscape.js
draws curved edges and handles pan, zoom, and selection. A loopback-only Fastify API reads the
installed Flywheel CLI or reads legacy Hypergraph Markdown files directly.
Only synthetic demo data is stored in this project.

## Flywheel live-view experiment

On `experiment/flywheel-live-replica`, add `renderer=flywheel` to try an independently implemented study of the [live Flywheel graph viewer](https://flywheel.paradigma.inc/):

- [Cadex](http://127.0.0.1:4311/?repo=../cadex&renderer=flywheel)
- [Lab](http://127.0.0.1:4311/?repo=../lab&renderer=flywheel)
- [Demo](http://127.0.0.1:4311/?demo&renderer=flywheel)
- [1,000-node research fixture](http://127.0.0.1:4311/?debug=1&shape=research&count=1000&seed=7&renderer=flywheel)

This version has a charcoal canvas, dashed component orbits and generation rings, white roots, colored tag halos, pink stacked-circle run/fan summaries, thin straight edges, and zoom-dependent labels. Click a component outline to focus, stacked circles to expand, or a node for details. Drag nodes or pan; scroll to zoom. **View** contains folding, guides, citations, labels and search controls. **F** fits, **C** folds again.

The replica is opt-in; the existing radial renderer and its debug controls remain available. Replica debug mode retains graph-generation controls and uses its own View controls for presentation. Source repositories stay read-only. No live website account or network connection is required to render local graphs.

See [research notes, public bundle references, implementation and fidelity limits](docs/flywheel-live-study.md). It reproduces the visual conventions and core interactions, not the full production layout engine.

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
and 2,531 citations). Graphs open with all displayed nodes and chain markers fitted on screen and refit when
the viewport changes. Press **F** to restore the overview after exploring. Citations are real
cross-links and can make the overview dense; none are silently hidden.

## Debug playground

Open **http://127.0.0.1:5173/?debug** (or port 4311 for the production server).
The panel offers 16 shapes: the research demo, balanced tree, deep chain, wide
star, lopsided tree, repeated merges, directed cycle, disconnected islands,
dense graph, seeded random structure, evolving research, research bursts, parallel projects,
loops/parallel edges, a single node, and an empty graph.

- Set **Nodes** (2–2,000) and **Branches / islands** where applicable. The demo,
  single-node, and empty presets have fixed sizes.
- **Random structure** mixes uneven containment branches, disconnected roots, and
  optional cross-links. **Add cross-links** is off by default; enable it to stress
  non-tree relationships. **Seed** reproduces its topology; **Link density** controls the extra
  cross-links (up to roughly four per node at maximum density).
- **1,000-node research** starts a large seeded fixture. **Evolving research** mixes
  experiment chains, forks and merges; **Research bursts** alternates wide parallel
  experiments with follow-up chains; **Parallel projects** grows independent roots.
  Optional citations connect earlier evidence. Change **Seed** / **Next seed** to
  explore variations. These are synthetic stress cases, not a statistical model of research.
- **Ring layout** compares branch-local rings, previous adaptive depth rings,
  and classic depth rings. **Role colors and shapes** optionally distinguishes roots
  (amber diamonds), forks (cyan circles), and merges (violet hexagons). Hypergraph
  plan/state tags take precedence, using amber/cyan respectively. Other nodes remain gray.
- Dense graphs are limited to 60 nodes. **Link density** and **Seed** generate
  reproducible cross-links; **Next seed** produces a different case.
- **Ring distance**, **Node spacing**, **Curve strength**, and **Show labels**
  change the rendering live. Branch-local rings use a radial pitch of the larger of node
  spacing and 65% of ring distance, with node spacing also enforced around each ring.
  Previous adaptive rings retain one radius per depth with a minimum radial gap.
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

All live nodes are represented, including disconnected nodes. Containment edges
are dashed dark gray; semantic edges are solid light gray. Arrowheads indicate
direction. Edges bow away from the radial center along quadratic Bézier curves.
The bend is determined geometrically for each edge, independently of its direction
or relationship type. Spokes through the center stay straight. Containment defines
the rings; semantic edges connect nodes without changing their placement.
The default is again the **original fixed-sector radial layout**: a node's children
share a ring and descendants stay in their branch's angular sector. Large graphs
are simplified before layout using chains and nested branch summaries, rather
than filling spare space with unrelated nodes.

Add **`&rings=adaptive`** to compare independent depth radii, or **`&rings=compact`**
for the branch-local spacing experiment. These remain available in debug. All
modes use the same full-fit camera and detail rendering. Add **`&appearance=roles`**
for optional role colors and shapes. The default remains monochrome.

Disconnected components share an implied center; no extra node or relationship is
created. Cycles and multiple parents are reduced to a spanning forest for placement
only; original relationships are retained, including inward merge and cycle edges;
collapsed interiors use the projection described below.
Containment takes priority, then explicit parent links, then non-citation semantic
links. Citations never move nodes when an explicit hierarchy exists.
Cross-links can still cross other branches; random fixtures generate them only
when **Add cross-links** is enabled. Live repository relationships remain visible.
Long titles are shortened on the canvas, and labels disappear at distant zoom
levels. Every graph opens fully fitted, and resizing fits it again. Large graphs
use zoom-dependent circle and edge sizes so the overview does not shrink them
unnecessarily below a useful pixel size. Circle growth is bounded by layout
spacing; very large or deep graphs can still become too dense to distinguish on
small screens. Hover or select a node to reveal its label at readable size and
highlight direct relationships; hovering also supplies the full title. Visible relationships use reduced emphasis at overview scale. Pan and zoom to explore,
and press **F** / **0** to return to the overview. Late tag enrichment preserves
the current camera and selection.

Loading, empty repositories, and failed reads leave the
screen black. Failures are reported in the browser console; accessible labels
identify loading and error states. There are no error banners or loading overlays.

For real repositories, the viewer shows committed topology only. It does not display staging, node
bodies, rendered Markdown, or search results. Hypergraph explicit citations are
read as edges; Flywheel prose is not parsed for citations.
UUID mentions in content are never inferred as graph edges. There is no graph
editing, automatic polling, hosted service, or external synchronization.

## Collapsed chains

Uninterrupted parent–child runs now collapse by default: **first node → stacked
ellipsis marker → last node**. A marker replaces at least two intermediate nodes;
its label gives their count. Forks and merges remain visible. Cycles are left
intact. Chain detection follows containment, then explicit parent relationships,
then non-citation semantic links. It uses distinct neighbors so duplicate links
cannot accidentally create a fork.

Click a marker to expand its chain. Focus the canvas and press **C** to collapse
expanded chains again. The layout refits after expansion or collapse. Add
**`&chains=0`** to a repository URL to compare with every original node visible,
or uncheck **Collapse linear chains** in debug. The debug toggle is saved in its
URL; individually expanded chains are temporary view state.

External links to an intermediate node attach to its marker while collapsed;
edge identities, types and directions are retained. Internal edges are hidden
inside the marker. Expansion restores exact original nodes and edges. Tags on
markers are the union of their members' tags, so tag spotlight still finds them.
No source graph data is modified. Debug node/edge totals describe the source graph,
while the canvas accessibility description includes the displayed and original
node counts.

## Nested branch summaries

When more than 40 nodes remain after chain collapse, the viewer builds a display
forest from the parent hierarchy and folds deeper subtrees into ellipses. Wide
sets of siblings are partitioned in source order into at most five groups per
parent. These are navigational groups, not inferred research topics. Their labels
count original nodes, including nodes inside chain markers.

Click a branch ellipsis to reveal its next level; children may themselves be
ellipses. Chain markers continue to expand their linear interiors. **C** restores
the folded overview. Disconnected components and multiple parents use the same
spanning-forest convention as the radial layout; secondary relationships remain
cross-links. A thin display-tree link through a sibling group expresses grouping,
not a new causal relationship in the source graph.

The overview emphasizes the tree. Cross-links are aggregated by visible endpoints,
kind and relation and faded until hovered or selected; links internal to a folded
branch are represented inside its marker. Turn off **Nest branch summaries** in
debug, or add **`&branchesCollapsed=0`**, to compare the chain-only graph. Also add
**`&chains=0`** for the original uncollapsed nodes and individual edges. Expansion
refits the view and can change angular allocation; stable positions across levels
are not guaranteed. Source files remain untouched.

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
- `src/collapse-branches.ts`: nested sibling/subtree summaries and projected cross-links.
- `src/collapse-chains.ts`: reversible projection of linear interiors into chain markers.
- `src/layout.ts`: Radial geometry for all nodes, with space reserved for circular nodes and their labels.
- `src/compact-rings.ts`: branch-local collision spacing with fixed subtree directions.
- `src/GraphCanvas.tsx`: canvas rendering with optional role encoding and pointer/keyboard gestures.
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
