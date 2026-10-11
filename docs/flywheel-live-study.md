# Flywheel live-view study

Experiment branch: `experiment/flywheel-live-replica`. The prior nested-ring work is checkpointed at `1ccae2f`.

## Reference and method

Inspected the public [Flywheel website](https://flywheel.paradigma.inc/) on 2026-10-10, including Explore, overview and zoomed graph views. The public page reported 3,245 displayed nodes and 6,517 edges at inspection time. These counts change with the site's data. Its HTML release identifier was `8583e4193e6d66acd5c441b8e2eb7257019fa9ce`.

Read and formatted publicly served JavaScript/CSS for inspection. No authentication, private data, source maps, or backend access was needed. Downloaded reference bundles remain outside the repository in `/tmp/flywheel-reference`; the implementation here is independently written TypeScript, not a vendored copy of the website application.

Useful published modules (hashed URLs may expire with deployment):

- [Canvas entry](https://flywheel.paradigma.inc/assets/FreeGraphCanvas-JTLiEmkv.js): Sigma reconciliation, gestures, overlays.
- [Visual contract](https://flywheel.paradigma.inc/assets/nodeVisualContract-DCbrRbQ0.js): 36-unit free-view node radius, title LOD, tag halo geometry.
- [Layout and projection](https://flywheel.paradigma.inc/assets/freeViewCenterChoice-fDbdBfUm.js): generation rings, component packing, chain folding, leaf fans.
- [Canvas overlays](https://flywheel.paradigma.inc/assets/useViewTransformAnimation-iaX6rQf7.js): guide ring styles and three-circle folded glyphs.
- [Theme CSS](https://flywheel.paradigma.inc/assets/index--AemibLq.css): dark palette.
- [Product tutorial](https://docs.flywheel.paradigma.inc/tutorial): canvas navigation and node interactions.

## Observed design

The free view has a global orbital field and a local structure inside each graph. Disconnected graphs sit on gray dashed orbits; local generation rings are green, with a gold component outline (blue for multi-root components). The largest graph can occupy the center. Clicking an outline or a small graph zooms to it.

Roots are white circles. Other node bodies use access/type colors and segmented tag halos. The local adapter has no access colors, so this study uses the live neutral/private palette (`#43566d`, `#9aa7b7`) without asserting that a node is private. No visibility badges are fabricated.

Folded runs and leaf fans use three overlapping pink circles aligned with the path, followed by an ellipsis. Observed constants: fill `#4a3346`, border `#d3869b`, 1.5px border, minimum circle radius 4.5px, overlap step 0.82 of the small radius. The default run policy folds at three interior nodes; fans bundle six or more singly parented terminal children. The live run threshold also has policy overrides and hysteresis.

The live free-view edges observed at detail scale are fine straight segments, not the bowing curves of our earlier experiment. Titles are collision-filtered and zoom-dependent, with graph titles emphasized at overview scale.

## This implementation

- `src/flywheel-model.ts`: structural components, run/fan projection, deterministic generation rings, angular separation, orbital packing. Parent topology controls placement; citations remain cross-links.
- `src/FlywheelCanvas.tsx`: Canvas 2D renderer, screen-space guides/edges, folded glyphs, tag halos, title LOD, hover traces, node dragging, pan/zoom, selection highlighting, component focus.
- `src/flywheel.css`: full-screen charcoal canvas styling. Local styling now uses a faint neutral outer outline and density-faded gray generation rings instead of the reference gold/green rings; R cycles occupied arcs, orbital ticks, soft occupied bands, feathered mist bands, outlined ribbons, alternating terraces, solid, dotted (default), dashed, and hidden guides (`ringStyle` URL parameter). Arcs/bands merge occupied angular intervals on each generation; ticks bracket individual node angles. These three modes use four small outer boundary brackets. These guides describe placement, not additional relationships.
- `?renderer=flywheel`: opt-in route supported by demo, repository and debug views. Removing it returns to the original experiment.

The source graph is unchanged. Clicking a fold expands its members; C collapses again. F or 0 fits; +/- zoom; Escape clears selection. Resize and projection changes refit the camera. Node drags and expanded folds are temporary.

At inspection, Cadex's 1,120 original nodes projected to 223 displayed nodes, 44 run/fan summaries and three components (record/state/plan). All original nodes are represented. The source repository is never modified.

## Fidelity limits and next comparisons

This is a visual/interaction replica, not the complete production algorithm. The live site uses Sigma/WebGL and additional staged loading, occupancy-aware guide arcs, layout validation, component packing and automatic LOD policies. Our implementation uses Canvas 2D, a deterministic spanning order with longest-path DAG generations, collision-constrained ring angles, simpler orbital packing, full local guide circles, and manual fold expansion. Cycles fall back to finite BFS generations. Layout runs on the main thread; tens of thousands of nodes are not yet benchmarked.

Tag colors are stable hashes because our normalized tags lack the live site's stored color metadata. Access badges, banners, full node content/artifacts, auth, editing, timeline and server features are outside this graph-view experiment. The local viewer omits the hosted site’s header, controls, inspector, and help overlays. A small collapsible Ring Lab panel switches guide styles and adjusts ink/width without changing the camera; settings persist in the URL. Graph labels, guides and tag halos remain.

Parallel projected links with identical endpoint/kind/relation are combined while folded. Cross-links internal to a fold return when expanded. Local source data and the public site's data differ, so screenshots do not establish pixel-identical layout. Expanded long chains still produce many sparse rings; that is a useful comparison against our nested branch approach.

Next useful comparisons: Cadex record-only with citations toggled, three separate project chains, broad leaf fans, and the seeded 1,000-node research fixture. Compare initial overview, component focus, and close node scale separately.

## Validation

Unit tests cover run/fan thresholds, expansion, source immutability, full membership coverage, valid edges, deterministic finite coordinates, separated component bounds/node bodies, cycles and citation-independent placement across large fixture families. Browser tests cover fold clicks/reset, minimal presentation after selection, style switching and URL replay, pan/zoom/refit, mobile resize, and renderer persistence when switching debug seeds/shapes. Visual checks include live-site overview/detail and local Cadex, research, burst and teams graphs.

One stress check exposed expensive offscreen dashed circles when zooming into an unfolded 1,000-node chain. Viewport culling fixed the interaction stall; the offscreen-circle culling remains in the graph renderer.
