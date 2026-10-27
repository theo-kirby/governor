# governor

A record/state research graph on [Flywheel](https://docs.flywheel.paradigma.inc): the
conventions, the agent skills, a small CLI, and a graph viewer. The memory is
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
git clone https://github.com/theo-kirby/governor.git && cd governor
npm ci && npm run build        # the build is what `governor viz` serves
npm link                       # puts `governor` on PATH
```

In a project:

```sh
flywheel repo:init                       # once, at the checkout root; gitignore .flywheel/ and .governor/
governor init --title "My project"
governor skills install                  # governor-orient, governor-record, governor-fold → .claude/skills
```

## Commands

|                                                                                                            |                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `governor orient`                                                                                          | the frontier, the unfolded tail with its impacts, recent records |
| `governor record --title T --body F --parent SLUG (--impact "SLUG: Δ" \| --new "name: Δ" \| --none "why")` | append one record                                                |
| `governor fold` / `governor fold --apply plan.json`                                                        | list the tail / apply a fold                                     |
| `governor check`                                                                                           | the rules G1–G7; exit 1 on a violation                           |
| `governor render -o STATE.md`                                                                              | the state as markdown                                            |
| `governor head`                                                                                            | the repository head (cheap; a cache key)                         |
| `governor snapshot`                                                                                        | the whole graph as JSON                                          |
| `governor viz [--port N]`                                                                                  | the hub viewer for this repository                               |
| `governor skills install [--user \| --target DIR]`                                                         | copy the agent skills                                            |

`governor help` lists every option. Run inside a git worktree, every command resolves to
the main checkout's repository. Writes serialize on a lock in `.governor/`, and a commit
never sweeps up staged work governor did not stage. Reads replay the repository log
(about 0.5 s for 1,100 nodes), so nothing is mirrored into files.

## The viewer

A local, read-only graph viewer with two layouts on a Canvas 2D:

- **Hub** (`?layout=hub`, the default for `governor viz`): one graph drawn as a wheel.
  The root is at the centre; claims sit on rings by depth, each subtree in a sector sized
  by its claims and evidence; records sit on the rim, packed newest-first into the free
  slot nearest the claims they impact or that cite them, so each claim's evidence stacks
  outward as a tooth. Status tags colour the claims. `src/hub-model.ts` is the layout.
- **Orbital** (the default otherwise): disconnected graphs on dashed orbits, generation
  rings inside each one, and long runs and leaf fans folded into stacked-circle
  summaries. `src/flywheel-model.ts` is the layout. It also opens any Flywheel
  repository that is not a governor graph.

Click a node to open its detail panel (body, citations, history). Drag to pan,
**Shift + scroll** or **+/-** to zoom, **F** / **0** to fit, **Escape** to clear the
selection. In the orbital view, **C** folds the graph again; in the hub view, **N** names
the nodes.

### Running it

```sh
npm run dev      # API on :4311, Vite on http://127.0.0.1:5173
npm start        # production server on http://127.0.0.1:4311 (after npm run build)
```

| URL parameter |                                                                             |
| ------------- | --------------------------------------------------------------------------- |
| `?repo=PATH`  | read the Flywheel repository at `PATH` (remembered in local storage)        |
| `?layout=hub` | the hub layout                                                              |
| `?demo`       | a synthetic 16-node graph (`src/demo.ts`); no API calls                     |
| `?debug`      | synthetic graph controls (shape, size, seed, links); no repository requests |

| Environment variable      |                                                                             |
| ------------------------- | --------------------------------------------------------------------------- |
| `FLYWHEEL_REPO`           | the repository to open when the URL names none                              |
| `FLYWHEEL_REPO_LOCK=1`    | serve `FLYWHEEL_REPO` only, whatever `?repo=` says                          |
| `GOVERNOR_DEFAULT_PARAMS` | URL parameters to apply when the URL names no repository, e.g. `layout=hub` |
| `PORT`                    | the server port (default 4311)                                              |

With no repository, the viewer opens the demo. Topology loads first, then tags for the
same commit. Reload to read new commits.

### Report embed

`npm run build:report` writes `dist-report/`: a self-contained script and stylesheet
(`assets.json`) that draws a graph from a `<script id="flywheel-snapshot"
type="application/json">` on the host page, with no network access, and
`report-export.mjs`, which prints a consistent committed snapshot of a repository as JSON
(`node dist-report/report-export.mjs PATH`). The host page may set
`data-theme="light"` and `data-layout="organic"` on `<html>`, colours in
`window.GRAPH_THEME`, and node bodies in a `<script id="flywheel-bodies">` (see
`src/report.tsx`); without bodies, nodes show titles only.

## Architecture

- `cli/main.ts`, `lib/`: the CLI; snapshot from the repository log, rules, render, writes.
- `skills/`: the agent skills that `governor skills install` copies.
- `server/app.ts`: loopback API, path validation, host/origin checks, a required request
  header, and a content security policy in production.
- `server/governor.ts`: governor graphs for the viewer; `server/adapter.ts`: validated,
  paginated, read-only Flywheel CLI calls for other repositories.
- `src/App.tsx`: repository selection and loading; `src/HubCanvas.tsx` and
  `src/FlywheelCanvas.tsx`: the two renderers; `src/NodePanel.tsx`: the detail panel.
- `src/report.tsx`, `server/report-export.ts`, `shared/report.ts`: the report embed.
- `shared/types.ts`: normalized graph types.

## Development and checks

```sh
npm run check                     # unit tests and the build
npx playwright install chromium
npm run test:ui                   # browser tests
npm run format
```

`PLAYWRIGHT_EXECUTABLE_PATH` selects an existing Chromium. `VIEWER_URL=http://127.0.0.1:4311
npm run test:ui` targets a running production viewer (for example, when port 5173 is in
use). All test fixtures are synthetic.

## Privacy

- The server listens on loopback only. There is no hosting, upload or external sync.
- Keep graph databases, backups, exports, credentials, screenshots and real-data fixtures
  out of Git (`.gitignore` covers the usual ones).
- Titles render as canvas text, never HTML, and the viewer loads no remote assets. The
  API does not log graph content or repository paths.
- The viewer never writes to a graph. Graph writes stay in governor and the Flywheel CLI;
  never edit graph tables or copy a live SQLite database.

## Flywheel docs

- [Installation](https://docs.flywheel.paradigma.inc/install)
- [Repository model](https://docs.flywheel.paradigma.inc/concepts/repos)
- [CLI reference](https://docs.flywheel.paradigma.inc/cli)
