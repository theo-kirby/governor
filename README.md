# flywheel-viz

A local, read-only Flywheel and legacy Hypergraph graph viewer. The live-view replica with dotted generation rings is the sole renderer and the version maintained on `main`. It opens on a charcoal canvas with neutral guides, white roots, colored tag halos, pink stacked-circle summaries, straight edges, and zoom-dependent labels. No renderer parameter is needed.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173/?demo** for the synthetic 16-node demo, or **http://127.0.0.1:5173/?repo=../lab** for a local repository. For the production server, use port 4311.

The old radial, adaptive-ring, focus-lens, radial-atlas, research-rivers, and ring-style experiments have been retired. Old renderer and ring-style URL parameters are ignored.

## Graph interaction

- Drag the background to pan, drag nodes to move them, and scroll to zoom.
- Click a component outline to focus, a node to highlight its relationships, or stacked circles to expand a folded run or fan.
- **F** / **0** fits the graph, **C** folds it again, **Escape** clears selection, and **+/-** zooms.
- Dotted generation rings fade when densely packed; component boundaries use faint solid outlines and component orbits use dashed guides.

The normal viewer has no header, inspector, or control panel. Loading and failed reads leave a blank screen; failures are reported in the browser console. Reload to read current graph data. Source repositories remain read-only.

## Demo and debug fixtures

`?demo` bypasses all repository settings and API calls without changing the remembered repository. An unconfigured viewer also opens the demo. Edit `src/demo.ts` to change the synthetic nodes, parent IDs, tags, and semantic relationships.

`?debug` opens synthetic graph controls and takes precedence over repository and demo settings. Choose a shape, node count, branches, seed, cross-links, link density, and tagged fraction. The 1,000-node research preset exercises folding and larger layouts. Fit, reset, and copy-link controls are available; settings persist in the URL. Debug mode makes no repository requests.

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

## Architecture

- `src/App.tsx`: repository selection, topology loading, and background tag enrichment.
- `src/FlywheelCanvas.tsx`: Canvas 2D rendering, dotted guides, gestures, selection, and folding.
- `src/flywheel-model.ts`: run/fan projection, generation rings, and component layout.
- `src/collapse-chains.ts`: shared reversible chain projection used by the replica.
- `src/DebugView.tsx` and `src/debug-graphs.ts`: synthetic fixtures and reproducible controls.
- `server/adapter.ts`: validated, paginated, read-only Flywheel CLI calls and commit-head guards.
- `server/hypergraph.ts`: legacy Markdown/YAML adapter and citation resolution.
- `server/app.ts`: loopback API, path validation, host/origin checks, and required request header.
- `shared/types.ts`: normalized graph types.

React + TypeScript + Vite provide the app shell; Fastify serves the local API. The browser uses Canvas 2D without Cytoscape. See [replica research and fidelity limits](docs/flywheel-live-study.md).

For Flywheel repositories, topology is committed state; tags load afterward for the same commit. The viewer does not edit graphs, render node bodies, poll automatically, or synchronize externally. Tag colors are stable hashes. Snapshots stay in memory; only the last successful repository path is stored locally.

## Development and checks

```sh
npm run check
npx playwright install chromium
npm run test:ui
npm run format
```

`PLAYWRIGHT_EXECUTABLE_PATH` can select an existing Chromium executable. `VIEWER_URL=http://127.0.0.1:4311 npm run test:ui` targets an existing production viewer. Tests use synthetic fixtures and cover adapters, API safeguards, projection/layout, repository loading, dotted defaults, folding, gestures, resize, and debug URL replay.

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

Browser tests can target an existing production viewer with `VIEWER_URL=http://127.0.0.1:4311 npm run test:ui` when port 5173 is occupied.
