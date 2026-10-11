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
  import("./FlywheelCanvas").then((module) => ({
    default: module.FlywheelCanvas,
  })),
);

export function DebugView() {
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
  useEffect(() => {
    const query = debugQuery(settings);
    history.replaceState(null, "", `?${query}`);
    setCopied(false);
  }, [settings]);
  const update = (patch: Partial<DebugSettings>) =>
    setSettings((previous) => normalizeSettings({ ...previous, ...patch }));
  const fixedSize = ["demo", "empty", "single"].includes(settings.shape);
  const slider = (
    label: string,
    key: "density" | "tagRate",
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
            <p className="debug-note">
              Click stacked circles to expand; press C to fold and F to fit.
            </p>
            {!fixedSize && slider("Tagged fraction", "tagRate", 0, 1, 0.05)}
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
