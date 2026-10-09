# flywheel-viz

A local, read-only viewer for the official Flywheel research graph.

This repository is a starting point only. No application, framework, dependencies
or viewer implementation has been chosen. Theo will take it from here.

## Why this exists

Theo uses `@paradigma-inc/flywheel` as local research memory for the lab. Its
npm CLI 0.2.78 exposes `flywheel ui`, but an actual launch on this MacBook Air
fails with `ui_web_files_missing`: the published package omits the web assets.

The bundled CLI source describes a Mac app with those assets, or a Paradigma
source checkout with `npm run build:local` in `project/flywheel-webui`. As of
2026-10-09, we found no public Mac-app download or accessible public source
checkout. The official installer installs the same npm package. Theo chose to
start an independent local viewer.

This project is separate from both Paradigma's official UI and Theo's archived
`flywheel-local` implementation. Do not assume their storage formats match.

## Local context

- Development checkout: `~/flywheel-viz` on Air (hostname `mba`).
- GitHub: private `theo-kirby/flywheel-viz`.
- Initial graph to inspect: `~/lab/.flywheel/` on this machine.
- Installed CLI: `~/.local/bin/flywheel`, version 0.2.78.
- The lab graph was transferred from Notebook using a verified backup/restore.
  Air is its sole writer. Other machines leave Markdown handoffs for Air.
- Lab workflow and graph roots: `~/lab/docs/FLYWHEEL.md` and `~/lab/STATE.md`.

The graph is local and Git-ignored. It has no hosted association. This GitHub
repository contains viewer source and documentation, not graph data.

## Intended first version

- Select a local Flywheel repository; use `~/lab` as a development example,
  not a hardcoded requirement.
- Browse nodes and inspect their titles, summaries and Markdown content.
- Navigate containment and semantic edges as distinct relationships.
- Make Lab's Record, State and Reference containers easy to explore.
- Show committed state by default; clearly distinguish staging if exposed.
- Start with viewing only. Editing, reconciliation and graph writes stay in
  the existing CLI workflow.

Lab's graph convention uses immutable evidence records and mutable state
handoffs. State-to-record UUID citations are not automatically causal edges.
The data adapter should preserve that distinction.

## Data access and boundaries

Prefer supported local CLI reads where practical:

```sh
flywheel repo:status --repo ~/lab --format=json
flywheel repo:node:list --repo ~/lab --format=json
flywheel repo:node:get <node-uuid> --repo ~/lab --format=json
flywheel repo:containment:list <container-uuid> --repo ~/lab --format=json
```

Inspect CLI help for further reads, schemas and pagination before implementing
an adapter. If direct SQLite reads are needed, open the database read-only and
use consistent transactions. Its schema is an implementation detail: record
and validate the supported version. Do not edit its tables or copy a live
SQLite database as a backup.

- Serve on loopback only; no hosted deployment, graph upload or external sync.
- Keep databases, backups, graph exports, credentials and real-data fixtures
  out of Git, even though this repository is private.
- Use synthetic fixtures for tests and examples.
- Render graph content as untrusted input; avoid arbitrary HTML/script execution.
- Keep the viewer's caches and preferences separate from the source graph.

A prior audit found no usable credentials in the lab graph, but it includes
private operational and project context. That is not a guarantee about future
content; treat all graph data as private.

## Starting points

- [Official installation docs](https://docs.flywheel.paradigma.inc/install)
- [Repository model and local commands](https://docs.flywheel.paradigma.inc/concepts/repos)
- [CLI reference](https://docs.flywheel.paradigma.inc/cli)
- Installed local server/UI code:
  `~/.local/lib/node_modules/@paradigma-inc/flywheel/src/runtime/vendor/flywheel-cli-dist/commands/ui.js`
  and its sibling `ui/` directory. Inspect these for behavior, not as a claim
  that the frontend is bundled or that upstream code may be copied freely.
- Existing local `~/hypergraph-viz` and `~/excaligraph` may offer visual ideas;
  they target different graph conventions and are not drop-in data adapters.

Next: choose a stack and implement a small read-only graph browser. No setup
or run command exists yet.
