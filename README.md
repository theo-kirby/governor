# governor

A record/state research graph on [Flywheel](https://docs.flywheel.paradigma.inc): the
conventions, the agent skills, a small CLI, and the hub viewer. The memory is
**one Flywheel graph** in the project's local repository (`.flywheel/`, pushed and pulled
through a hosted Flywheel repository); governor keeps no data of its own.

- **Records**: an append-only log of what happened, each with its causal parent and its
  declared impact on state.
- **State**: a small, single-writer distillation of what is true now, each claim citing
  the records it rests on, with a status tag (`open`, `working`, `broken`, `blocked`,
  `superseded`).
- **The fold**: the only writer of state, which applies the unfolded tail of records.

The model and its rules are in [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Install

Needs Node ≥ 24.15 and the `flywheel` CLI (`npm install -g @paradigma-inc/flywheel`).

```sh
git clone git@github.com:theo-kirby/governor.git && cd governor && npm ci
npm link                       # puts `governor` on PATH
```

In a project:

```sh
flywheel repo:init                       # once, at the checkout root; gitignore .flywheel/ and .governor/
governor init --title "My project"
governor skills install                  # governor-orient, governor-record, governor-fold → .claude/skills
```

## Commands

| | |
|---|---|
| `governor orient` | the frontier, the unfolded tail with its impacts, recent records |
| `governor record --title T --body F --parent SLUG (--impact "SLUG: Δ" \| --new "name: Δ" \| --none "why")` | append one record |
| `governor fold` / `governor fold --apply plan.json` | list the tail / apply a fold |
| `governor check` | the rules G1–G7; exit 1 on a violation |
| `governor render -o STATE.md` | the state as markdown |
| `governor snapshot` | the whole graph as JSON |
| `governor viz [--port N]` | the hub viewer for this repository |

Run inside a git worktree, every command resolves to the main checkout's repository.
Writes serialize on a lock in `.governor/`, and a commit never sweeps up staged work
governor did not stage. Reads replay the repository log (about 0.5 s for 1,100 nodes),
so nothing is mirrored into files.

## The hub view

`governor viz` (or the viewer below with `?layout=hub`) draws the graph as one wheel:
- **the root** at the centre;
- **claims** on rings by depth, each subtree in a sector sized by its claims and
  evidence;
- **records** on the rim, packed newest-first into the free slot nearest the claims they
  impact or that cite them, so each claim's evidence stacks outward as a tooth.

Hover or click to see a node's citations and history. `src/hub-model.ts` is the layout.


## The viewer (from flywheel-viz)

A local, read-only Flywheel graph viewer. The live-view replica with dotted generation rings is the sole renderer and the version maintained on `main`. It opens on a charcoal canvas with neutral guides, white roots, colored tag halos, pink stacked-circle summaries, straight edges, and zoom-dependent labels. No renderer parameter is needed.

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

## Architecture

- `src/App.tsx`: repository selection, topology loading, and background tag enrichment.
- `src/FlywheelCanvas.tsx`: Canvas 2D rendering, dotted guides, gestures, selection, and folding.
- `src/flywheel-model.ts`: run/fan projection, generation rings, and component layout.
- `src/collapse-chains.ts`: shared reversible chain projection used by the replica.
- `src/DebugView.tsx` and `src/debug-graphs.ts`: synthetic fixtures and reproducible controls.
- `server/adapter.ts`: validated, paginated, read-only Flywheel CLI calls and commit-head guards.
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
