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
the nodes. **Settings** opens a collapsible sidebar (open initially on desktop).
It contains Fit graph, names, theme, Radial/Organic layout, guides, and citation visibility.
A fresh hub view uses the chosen compact, radial, dark configuration in
`src/hub-settings.ts` (`defaultSettings`). Explicit configs and preset URLs override it.

State settings include categorical arrangement (one ring per depth, compact rings,
or filled disc) and sliders for root clearance, depth spacing, node spacing, compact
ring spacing and stagger. State region size enlarges the status blobs, while State
connection width thickens their necks and lets more distant same-status nodes join.
These change the regions without moving nodes; defaults are 1.05× size and 0.75
connection width. Evidence outside is a toggle. The previous compact variants
remain available under Starting preset and populate the sliders, including Evidence
outside · roomier. Compact packing splits crowded levels across multiple rings;
small levels remain single rings. Organic adds a deterministic relaxation pass.

Record settings include show/hide, the percentage of newest records to retain,
placement near claims or evenly around the graph, and newest/oldest-first packing.
Sliders control distance from states, ring spacing, node spacing, sideways spread in
degrees, node size and opacity. Age colours and record regions are toggles. Preserve state outlines and Preserve
record outlines independently draw each node’s original circular region boundary
inside merged blobs, at its isolated region size. State outlines are on by default and record outlines are off; record
outlines follow Show record regions. Hiding or
filtering records leaves state placement unchanged before Organic relaxation. Size
and opacity change appearance without rebuilding the layout.

Every setting is stored in the URL. **Copy link** shares the full view (including any
repository path in the URL). **Copy config** copies settings-only JSON; **Save config**
downloads it; **Load config** imports it. Edit / paste JSON supports clipboard fallback
and manual config editing. Imports validate version and types, bound numeric settings,
and leave the current configuration intact on errors. Config files contain no graph
nodes or repository paths. Older `packing`, `organic` and `theme` URLs still work;
the sidebar converts them into the versioned `config` parameter.

### Running it

```sh
npm run dev      # API on :4311, Vite on http://127.0.0.1:5173
npm start        # production server on http://127.0.0.1:4311 (after npm run build)
```

| URL parameter                                                       |                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `?config=JSON`                                                      | versioned sidebar configuration; generated by Copy link                     |
| `?repo=PATH`                                                        | read the Flywheel repository at `PATH` (remembered in local storage)        |
| `?organic=1`                                                        | loosen the hub layout and show citation links                               |
| `?packing=compact-staggered` / `compact-tight` / `compact-evidence` | compact-ring variations                                                     |
| `?packing=compact` / `?packing=disc`                                | compact rings or filled-disc state placement in the hub                     |
| `?theme=light`                                                      | use the hub’s light theme (dark by default)                                 |
| `?layout=hub`                                                       | the hub layout                                                              |
| `?demo`                                                             | a synthetic 16-node graph (`src/demo.ts`); no API calls                     |
| `?debug`                                                            | synthetic graph controls (shape, size, seed, links); no repository requests |

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

The hub sidebar’s **Color palette** selector offers Classic, Ocean, Forest,
Sunset, and Neon colors in either light or dark mode. Palette choices are saved
in config JSON and links; configs without a palette use Ocean. **Randomize config**
samples the layout and appearance controls, including visibility settings.
**Undo randomize** restores the config from immediately before the last shuffle.

**Graph source** switches between a local Flywheel repository path, a seeded
random graph, and a procedural graph. Procedural sliders control state and record
counts, maximum state depth, target branches per state, and citations per record.
When counts exceed the branching target’s capacity, extra states go on the deepest
level. **Regenerate graph** chooses a new seed. Generated graphs are browser-only;
their source settings and seed are included in copied/saved configs and links.
Repository configs include the selected path. **Randomize config** changes only
layout and appearance, preserving the graph source and generator settings.
