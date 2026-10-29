import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { HubCanvas } from "./HubCanvas";
import { kindOf, type StatePacking } from "./hub-model";
import { useGraphSource } from "./use-graph-source";

import {
  applyPreset,
  colorPalettes,
  randomizeSettings,
  defaultSettings,
  parseSettings,
  presets,
  ranges,
  settingsFromUrl,
  settingsUrl,
  type HubSettings,
  type NumericSetting,
} from "./hub-settings";
import "./hub-viewer.css";
import { paletteColours } from "./hub-palettes";

export function HubViewer({defaultRepo = ""}: {defaultRepo?: string}) {
  const [initial] = useState(() => {
    try {
      return { settings: settingsFromUrl(location.search), message: "" };
    } catch {
      return {
        settings: defaultSettings,
        message: "Could not read this link’s config. Showing defaults.",
      };
    }
  });
  const [settings, setSettings] = useState(initial.settings);
  const [beforeRandom, setBeforeRandom] = useState<HubSettings | null>(null);
  const colours = useMemo(() => paletteColours(settings.palette, settings.theme), [settings.palette, settings.theme]);
  useEffect(() => {
    if (defaultRepo) setSettings(previous => previous.repoPath ? previous : {...previous, repoPath: defaultRepo});
  }, [defaultRepo]);
  const [message, setMessage] = useState(initial.message);
  const [open, setOpen] = useState(() => window.innerWidth >= 800);
  const [preset, setPreset] = useState("");
  const [transfer, setTransfer] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const deferred = useDeferredValue(settings);
  const source = useGraphSource(deferred, defaultRepo);
  const {nodes, edges, details} = source;
  const label = source.message;
  const [repoDraft, setRepoDraft] = useState(settings.repoPath || defaultRepo);
  useEffect(() => setRepoDraft(settings.repoPath || defaultRepo), [settings.repoPath, defaultRepo]);
  const recordCount = nodes.filter((n) => kindOf(n) === "record").length;
  const {
    packing,
    organic,
    rootGap,
    depthGap,
    stateRingGap,
    stateBlobSize,
    stateBlobJoin,
    stateAngularGap,
    stagger,
    evidenceOutside,
    recordGap,
    recordRingGap,
    recordAngularGap,
    recordSpread,
    showRecords,
    recordPercent,
    recordPlacement,
    recordOrder,
  } = deferred;
  const layoutOptions = useMemo(
    () => ({
      rootGap,
      depthGap,
      stateRingGap,
      stateBlobSize,
      stateBlobJoin,
      stateAngularGap,
      stagger,
      evidenceOutside,
      recordGap,
      recordRingGap,
      recordAngularGap,
      recordSpread,
      showRecords,
      recordPercent,
      recordPlacement,
      recordOrder,
    }),
    [
      rootGap,
      depthGap,
      stateRingGap,
      stateBlobSize,
      stateBlobJoin,
      stateAngularGap,
      stagger,
      evidenceOutside,
      recordGap,
      recordRingGap,
      recordAngularGap,
      recordSpread,
      showRecords,
      recordPercent,
      recordPlacement,
      recordOrder,
    ],
  );
  const appearance = useMemo(
    () => ({
      recordSize: settings.recordSize,
      recordOpacity: settings.recordOpacity,
      ageColours: settings.ageColours,
      recordBlobs: settings.recordBlobs,
      preserveStateOutlines: settings.preserveStateOutlines,
      preserveRecordOutlines: settings.preserveRecordOutlines,
      stateBlobSize: settings.stateBlobSize,
      guides: settings.guides,
      citations: settings.citations,
    }),
    [
      settings.recordSize,
      settings.recordOpacity,
      settings.ageColours,
      settings.recordBlobs,
      settings.preserveStateOutlines,
      settings.preserveRecordOutlines,
      settings.stateBlobSize,
      settings.guides,
      settings.citations,
    ],
  );
  useEffect(() => {
    history.replaceState(null, "", settingsUrl(settings, location.href));
  }, [settings]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() !== "n" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input, select, textarea, [contenteditable]"))
      )
        return;
      setSettings((value) => ({ ...value, names: !value.names }));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const update = <K extends keyof HubSettings>(
    key: K,
    value: HubSettings[K],
  ) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
    setPreset("");
  };
  const slider = (
    key: NumericSetting,
    title: string,
    unit = "×",
    disabled = false,
  ) => {
    const [min, max, step] = ranges[key];
    return (
      <label className="hub-slider">
        <span>
          {title}
          <output>
            {Number(settings[key].toFixed(2))}
            {unit}
          </output>
        </span>
        <input
          type="range"
          aria-label={title}
          min={min}
          max={max}
          step={step}
          value={settings[key]}
          disabled={disabled}
          onChange={(e) => update(key, Number(e.target.value))}
        />
      </label>
    );
  };
  const checkbox = (
    key:
      | "names"
      | "evidenceOutside"
      | "showRecords"
      | "ageColours"
      | "recordBlobs"
      | "preserveStateOutlines"
      | "preserveRecordOutlines"
      | "guides",
    title: string,
  ) => (
    <label className="hub-check">
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => update(key, e.target.checked)}
      />
      {title}
    </label>
  );
  const copy = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(success);
      setTransfer("");
    } catch {
      setTransfer(value);
      setMessage("Clipboard unavailable. Copy the text below.");
    }
  };
  const importConfig = (text: string) => {
    try {
      const next = parseSettings(JSON.parse(text));
      setSettings(next);
      setPreset("");
      setMessage("Config loaded.");
      setTransfer("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load config.",
      );
    }
  };
  const save = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(settings, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "governor-config.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Config downloaded.");
  };
  return (
    <div
      className={`hub-viewer hub-${settings.theme} ${open ? "sidebar-open" : ""}`}
    >
      <HubCanvas
        nodes={nodes}
        edges={edges}
        label={label}
        details={details}
        names={settings.names}
        organic={organic}
        statePacking={packing}
        theme={settings.theme}
        colours={colours}
        layoutOptions={layoutOptions}
        appearance={appearance}
      />
      <button
        ref={toggle}
        className="hub-settings-toggle"
        aria-expanded={open}
        aria-controls="hub-settings"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide settings" : "Settings"}
      </button>
      {open && (
        <aside
          id="hub-settings"
          className="hub-sidebar"
          aria-label="Graph settings"
        >
          <h2>Graph settings</h2>
          <button
            className="hub-fit"
            onClick={() =>
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }))
            }
          >
            Fit graph
          </button>
          <fieldset>
            <legend>Graph source</legend>
            <label>Source
              <select aria-label="Graph source" value={settings.graphSource} onChange={e => update("graphSource", e.target.value as HubSettings["graphSource"])}>
                <option value="repo">Repository / path</option>
                <option value="random">Random graph</option>
                <option value="procedural">Procedural graph</option>
              </select>
            </label>
            {settings.graphSource === "repo" ? <form onSubmit={e => {e.preventDefault(); update("repoPath", repoDraft.trim());}}>
              <label>Repository path<input aria-label="Repository path" value={repoDraft} placeholder="../my-project" onChange={e => setRepoDraft(e.target.value)} /></label>
              <button type="submit">Load repository</button>
            </form> : <>
              {slider("graphSeed", "Graph seed", "")}
              <button onClick={() => update("graphSeed", 1 + Math.floor(Math.random() * 999999))}>Regenerate graph</button>
              {settings.graphSource === "procedural" && <>
                {slider("graphStates", "State count", "")}
                {slider("graphRecords", "Record count", "")}
                {slider("graphDepth", "State depth", "")}
                {slider("graphBranches", "Target branches per state", "")}
                {slider("graphCitations", "Citations per record", "")}
                <p className="hub-help">States fill levels in order. If the branch target cannot fit the requested count, extra states fill the deepest level.</p>
              </>}
              <p className="hub-help">The seed reproduces the same graph. Random mode also chooses the counts and structure.</p>
            </>}
            <p role="status" aria-label="Graph source status" className="hub-help">{source.message}</p>
          </fieldset>
          <fieldset>
            <legend>View</legend>
            <label>
              Theme
              <select
                value={settings.theme}
                onChange={(e) =>
                  update("theme", e.target.value as HubSettings["theme"])
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label>
              Color palette
              <select aria-label="Color palette" value={settings.palette} onChange={(e) => update("palette", e.target.value as HubSettings["palette"])}>
                {Object.entries(colorPalettes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Layout
              <select
                value={settings.organic ? "organic" : "radial"}
                onChange={(e) =>
                  update("organic", e.target.value === "organic")
                }
              >
                <option value="radial">Radial</option>
                <option value="organic">Organic</option>
              </select>
            </label>
            {checkbox("names", "Show names")}
            {checkbox("guides", "Show guides")}
            <label>
              Citation links
              <select
                value={settings.citations}
                onChange={(e) =>
                  update(
                    "citations",
                    e.target.value as HubSettings["citations"],
                  )
                }
              >
                <option value="focus">On focus</option>
                <option value="all">All</option>
                <option value="none">Hidden</option>
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>State nodes</legend>
            <label>
              Starting preset
              <select
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  setSettings((previous) =>
                    applyPreset(previous, e.target.value as StatePacking),
                  );
                }}
              >
                <option value="" disabled>
                  Custom / current settings
                </option>
                {Object.entries(presets).map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              State arrangement
              <select
                value={settings.packing}
                onChange={(e) =>
                  update("packing", e.target.value as HubSettings["packing"])
                }
              >
                <option value="rings">One ring per depth</option>
                <option value="compact">Compact rings</option>
                <option value="disc">Filled disc</option>
              </select>
            </label>
            {slider("rootGap", "Root clearance")}
            {slider("depthGap", "Depth spacing")}
            {slider("stateAngularGap", "State spacing")}
            {checkbox("preserveStateOutlines", "Preserve state outlines")}
            {slider("stateBlobSize", "State region size")}
            {slider("stateBlobJoin", "State connection width", "")}
            <p className="hub-help">
              Larger regions surround more space. Wider connections thicken the
              necks and join more distant nodes of the same status.
            </p>
            {slider(
              "stateRingGap",
              "State ring spacing",
              "×",
              settings.packing !== "compact",
            )}
            {slider(
              "stagger",
              "Ring stagger",
              "",
              settings.packing !== "compact",
            )}
            {settings.packing === "compact" &&
              checkbox("evidenceOutside", "Evidence outside")}
          </fieldset>
          <fieldset>
            <legend>Record nodes</legend>
            {checkbox("showRecords", "Show records")}
            <p className="hub-help">
              Showing{" "}
              {settings.showRecords
                ? Math.ceil((recordCount * settings.recordPercent) / 100)
                : 0}{" "}
              of {recordCount} records. Filtering keeps the newest.
            </p>
            {slider("recordPercent", "Newest records", "%")}
            <label>
              Record placement
              <select
                value={settings.recordPlacement}
                onChange={(e) =>
                  update(
                    "recordPlacement",
                    e.target.value as HubSettings["recordPlacement"],
                  )
                }
              >
                <option value="anchored">Near supporting claims</option>
                <option value="even">Evenly around the graph</option>
              </select>
            </label>
            <label>
              Records nearest states
              <select
                value={settings.recordOrder}
                onChange={(e) =>
                  update(
                    "recordOrder",
                    e.target.value as HubSettings["recordOrder"],
                  )
                }
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
            {slider("recordGap", "Distance from states")}
            {slider("recordRingGap", "Record ring spacing")}
            {slider("recordAngularGap", "Record spacing")}
            {slider("recordSpread", "Sideways spread", "°")}
            {slider("recordSize", "Record size")}
            {slider("recordOpacity", "Record opacity", "")}
            {checkbox("ageColours", "Fade colours with age")}
            {checkbox("recordBlobs", "Show record regions")}
            {checkbox("preserveRecordOutlines", "Preserve record outlines")}
          </fieldset>
          <fieldset>
            <legend>Configuration</legend>
            <p className="hub-help">
              Links include the current view. JSON files contain settings only,
              without graph data.
            </p>
            <div className="hub-actions">
              <button onClick={() => {
                setBeforeRandom(settings);
                setSettings({...randomizeSettings(), graphSource: settings.graphSource, repoPath: settings.repoPath,
                  graphSeed: settings.graphSeed, graphStates: settings.graphStates, graphRecords: settings.graphRecords,
                  graphDepth: settings.graphDepth, graphBranches: settings.graphBranches, graphCitations: settings.graphCitations});
                setPreset("");
                setMessage("Config randomized. Undo restores the previous view.");
              }}>Randomize config</button>
              <button disabled={!beforeRandom} onClick={() => {
                if (!beforeRandom) return;
                setSettings(beforeRandom);
                setBeforeRandom(null);
                setPreset("");
                setMessage("Previous config restored.");
              }}>Undo randomize</button>
              <button
                onClick={() =>
                  copy(JSON.stringify(settings, null, 2), "Config copied.")
                }
              >
                Copy config
              </button>
              <button
                onClick={() =>
                  copy(settingsUrl(settings, location.href), "Link copied.")
                }
              >
                Copy link
              </button>
              <button onClick={save}>Save config</button>
              <button onClick={() => file.current?.click()}>Load config</button>
              <button
                onClick={() => setTransfer(JSON.stringify(settings, null, 2))}
              >
                Edit / paste JSON
              </button>
            </div>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Config file"
              onChange={async (e) => {
                const chosen = e.target.files?.[0];
                e.target.value = "";
                if (!chosen) return;
                if (chosen.size > 50000) {
                  setMessage("Config file is too large.");
                  return;
                }
                try {
                  importConfig(await chosen.text());
                } catch {
                  setMessage("Could not read the config file.");
                }
              }}
            />
            {transfer && (
              <>
                <textarea
                  aria-label="Config JSON or link"
                  value={transfer}
                  onChange={(e) => setTransfer(e.target.value)}
                />
                <button onClick={() => importConfig(transfer)}>
                  Apply JSON
                </button>
              </>
            )}
            <p
              role="status"
              aria-label="Configuration status"
              className="hub-help"
            >
              {message}
            </p>
          </fieldset>
          <details>
            <summary>Node titles ({nodes.length})</summary>
            <ul>
              {nodes.map((n) => (
                <li key={n.id}>{n.title}</li>
              ))}
            </ul>
          </details>
          <button
            onClick={() => {
              setOpen(false);
              toggle.current?.focus();
            }}
          >
            Close settings
          </button>
        </aside>
      )}
    </div>
  );
}
