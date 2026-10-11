# Migrating a Hypergraph project

`governor migrate-hypergraph` rebuilds a Hypergraph project's record, state and plan graphs
as one governor graph in an **empty** Flywheel repository.

```sh
hypergraph export --config .hypergraph/config.yml   # fresh .hypergraph/cache/*.json
flywheel repo:init /tmp/new-graph
governor migrate-hypergraph --from . --repo /tmp/new-graph
governor check --repo /tmp/new-graph
```

| Hypergraph | Governor |
|---|---|
| record root, state root | one governor root (slug and content from the record root, plus a `## Migrated` note) |
| plan root (a view) | a `plan` component under the root |
| node slug, title, summary, body | the same, except that a claim's `Status:` line becomes a status tag |
| `created_at` | a `## Recorded` section with `- at:`, and `- artifact:` lines for evidence paths |
| record `## State Impact` lines | impact edges record → claim. `NEW` lines stay as prose for a fold to apply. |
| claim `## Provenance` lines and `[rec: slug]` mentions | citation edges claim → record (the `## Provenance` reason as the edge content) |
| records inside the state root's high-water mark | tagged `folded` |
| parents | lineage; the old roots' children hang off the governor root |

The run commits every 500 operations (`governor migrate: part N`). `check` treats every
migrated record as legacy for G3, since Hypergraph's `none:` and impact lines were
already enforced. Cadex's 1,135 nodes are about 8,000 operations, around 25 minutes.

Cutting a project over:

1. Stop every writer.
2. Back up the old store with `flywheel repo:backup`.
3. Export, migrate, check.
4. Put the new repository at the checkout root.
5. Delete `.hypergraph/` and the `hypergraph-*` skills, then run `governor skills install`.
6. Point `AGENTS.md` at the governor skills.

Git history keeps the Hypergraph files for the rollback.
