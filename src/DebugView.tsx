import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  debugDefaults,
  debugQuery,
  generateDebugGraph,
  normalizeSettings,
  settingsFromUrl,
  shapes,
  type DebugSettings,
  type Shape,
} from "./debug-graphs";
const Graph = lazy(() =>
  import("./GraphCanvas").then((module) => ({ default: module.Graph })),
);

export function DebugView() {
  const [renderer] = useState(() =>
    new URLSearchParams(location.search).get("renderer"),
  );
  const [settings, setSettings] = useState(() =>
    settingsFromUrl(new URLSearchParams(location.search)),
  );
  const [collapsed, setCollapsed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [layoutMs, setLayoutMs] = useState(0);
  const [copied, setCopied] = useState(false);
  const graph = useMemo(
    () => generateDebugGraph(settings),
    [
      settings.shape,
      settings.count,
      settings.branches,
      settings.seed,
      settings.density,
      settings.crossLinks,
      settings.tagRate,
    ],
  );
  const tuning = useMemo(
    () => ({
      ringGap: settings.ringGap,
      spacing: settings.spacing,
      curvature: settings.curvature,
      labels: settings.labels,
      tags: settings.tags,
      tagFilter: settings.tagFilter,
      overview: true,
      chains: settings.chains,
      branchesCollapsed: settings.branchesCollapsed,
      rings: settings.rings,
      appearance: settings.appearance,
    }),
    [
      settings.chains,
      settings.branchesCollapsed,
      settings.rings,
      settings.appearance,
      settings.ringGap,
      settings.spacing,
      settings.curvature,
      settings.labels,
      settings.tags,
      settings.tagFilter,
    ],
  );
  useEffect(() => {
    const query = debugQuery(settings);
    if (renderer) query.set("renderer", renderer);
    history.replaceState(null, "", `?${query}`);
    setCopied(false);
  }, [settings]);
  const update = (patch: Partial<DebugSettings>) =>
    setSettings((previous) => normalizeSettings({ ...previous, ...patch }));
  const fixedSize = ["demo", "empty", "single"].includes(settings.shape);
  const slider = (
    label: string,
    key: "ringGap" | "spacing" | "curvature" | "density" | "tagRate",
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="debug-slider">
      <span>
        {label}
        <output>{settings[key]}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={settings[key]}
        onChange={(event) => update({ [key]: Number(event.target.value) })}
      />
    </label>
  );
  return (
    <main
      className={`graph-screen debug-workspace ${collapsed ? "" : "panel-open"}`}
      aria-label="Graph layout debug workspace"
    >
      <Suspense fallback={null}>
        <Graph
          key={revision}
          nodes={graph.nodes}
          edges={graph.edges}
          label={`Debug ${shapes[settings.shape][0]}`}
          tuning={tuning}
          onLayout={setLayoutMs}
        />
      </Suspense>
      <aside
        className={`debug-panel ${collapsed ? "collapsed" : ""}`}
        aria-label="Graph debug controls"
      >
        <div className="debug-heading">
          <span>GRAPH DEBUG</span>
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={
              collapsed ? "Expand debug controls" : "Collapse debug controls"
            }
          >
            {collapsed ? "+" : "−"}
          </button>
        </div>
        {!collapsed && (
          <>
            <label className="debug-field">
              Shape
              <select
                aria-label="Shape"
                value={settings.shape}
                onChange={(event) =>
                  update({ shape: event.target.value as Shape })
                }
              >
                {Object.entries(shapes).map(([value, [label]]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="debug-description">{shapes[settings.shape][1]}</p>
            <div className="debug-row">
              <label className="debug-field">
                Nodes
                <input
                  type="number"
                  min="2"
                  max={settings.shape === "dense" ? 60 : 2000}
                  value={settings.count}
                  disabled={fixedSize}
                  onChange={(event) =>
                    update({ count: Number(event.target.value) })
                  }
                />
              </label>
              <label className="debug-field">
                Branches / islands
                <input
                  type="number"
                  min="2"
                  max="8"
                  value={settings.branches}
                  disabled={
                    !["tree", "islands", "teams"].includes(settings.shape)
                  }
                  onChange={(event) =>
                    update({ branches: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            {["dense", "random", "research", "burst", "teams"].includes(
              settings.shape,
            ) && (
              <>
                {settings.shape !== "dense" && (
                  <label className="debug-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.crossLinks}
                      onChange={(event) =>
                        update({ crossLinks: event.target.checked })
                      }
                    />{" "}
                    Add cross-links
                  </label>
                )}
                {(settings.shape === "dense" || settings.crossLinks) &&
                  slider("Link density", "density", 0, 1, 0.05)}
                <div className="debug-row">
                  <label className="debug-field">
                    Seed
                    <input
                      type="number"
                      min="1"
                      max="99999"
                      value={settings.seed}
                      onChange={(event) =>
                        update({ seed: Number(event.target.value) })
                      }
                    />
                  </label>
                  <button
                    onClick={() =>
                      update({ seed: (settings.seed % 99999) + 1 })
                    }
                  >
                    Next seed
                  </button>
                </div>
              </>
            )}
            <div className="debug-actions">
              <button
                onClick={() =>
                  update({ shape: "research", count: 1000, crossLinks: true })
                }
              >
                1,000-node research
              </button>
            </div>
            {renderer !== "flywheel" ? (
              <>
                <label className="debug-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.chains}
                    onChange={(event) =>
                      update({ chains: event.target.checked })
                    }
                  />{" "}
                  Collapse linear chains
                </label>
                <label className="debug-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.branchesCollapsed}
                    onChange={(event) =>
                      update({ branchesCollapsed: event.target.checked })
                    }
                  />{" "}
                  Nest branch summaries
                </label>
                <p className="debug-note">
                  Click a chain marker to expand. Focus the graph and press C to
                  collapse again.
                </p>
                <label className="debug-field">
                  Ring layout
                  <select
                    aria-label="Ring layout"
                    value={settings.rings}
                    onChange={(event) =>
                      update({
                        rings: event.target.value as DebugSettings["rings"],
                      })
                    }
                  >
                    <option value="compact">Branch-local rings</option>
                    <option value="adaptive">
                      Previous adaptive depth rings
                    </option>
                    <option value="classic">Classic depth rings</option>
                  </select>
                </label>
                <label className="debug-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.appearance === "roles"}
                    onChange={(event) =>
                      update({
                        appearance: event.target.checked ? "roles" : "mono",
                      })
                    }
                  />{" "}
                  Role colors and shapes
                </label>
                {settings.appearance === "roles" && (
                  <p className="debug-note">
                    Amber diamonds: roots / plans. Cyan circles: forks / states.
                    Violet hexagons: merges. Gray circles: other nodes.
                    Hypergraph type takes precedence.
                  </p>
                )}
                <div className="debug-divider" />
                {slider("Ring distance", "ringGap", 70, 320, 10)}
                {slider("Node spacing", "spacing", 50, 240, 10)}
                {slider("Curve strength", "curvature", 0, 2.5, 0.1)}
                <label className="debug-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.labels}
                    onChange={(event) =>
                      update({ labels: event.target.checked })
                    }
                  />{" "}
                  Show labels
                </label>
                <label className="debug-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.tags}
                    onChange={(event) => update({ tags: event.target.checked })}
                  />{" "}
                  Show tags
                </label>
              </>
            ) : (
              <p className="debug-note">
                Flywheel study: use View on the canvas for folding, guides,
                citations, and labels.
              </p>
            )}
            {!fixedSize && slider("Tagged fraction", "tagRate", 0, 1, 0.05)}
            {renderer !== "flywheel" && (
              <>
                <label className="debug-field">
                  Spotlight tag
                  <select
                    aria-label="Spotlight tag"
                    value={settings.tagFilter}
                    onChange={(event) =>
                      update({ tagFilter: event.target.value })
                    }
                  >
                    <option value="">All nodes</option>
                    {[
                      ...new Set(
                        graph.nodes.flatMap(
                          (node) => node.tags?.map((tag) => tag.name) || [],
                        ),
                      ),
                      ...(settings.tagFilter ? [settings.tagFilter] : []),
                    ]
                      .filter((tag, index, tags) => tags.indexOf(tag) === index)
                      .sort()
                      .map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            <div className="debug-stats" aria-live="polite">
              <span>
                {graph.nodes.length} nodes · {graph.edges.length} edges
              </span>
              <span>Layout {layoutMs.toFixed(1)} ms</span>
            </div>
            <div className="debug-actions">
              <button onClick={() => setRevision((previous) => previous + 1)}>
                Fit graph
              </button>
              <button
                onClick={() => {
                  setSettings(debugDefaults);
                  setRevision((previous) => previous + 1);
                }}
              >
                Reset
              </button>
              <button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(location.href)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="debug-note">
              Synthetic data only. Settings are saved in the URL.
            </p>
          </>
        )}
      </aside>
    </main>
  );
}
