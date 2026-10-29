import type { StatePacking } from "./hub-model";

export const presets: Record<StatePacking, string> = {
  rings: "Original rings",
  compact: "Compact rings",
  "compact-staggered": "Compact · staggered",
  "compact-tight": "Compact · tighter",
  "compact-evidence": "Compact · evidence outside",
  "compact-evidence-roomy": "Evidence outside · roomier",
  disc: "Filled disc",
};
export const colorPalettes = {
  classic: "Classic",
  ocean: "Ocean",
  forest: "Forest",
  sunset: "Sunset",
  neon: "Neon",
} as const;
export const ranges = {
  graphSeed: [1, 999999, 1],
  graphStates: [1, 200, 1],
  graphRecords: [0, 800, 1],
  graphDepth: [1, 5, 1],
  graphBranches: [1, 20, 1],
  graphCitations: [1, 6, 1],
  rootGap: [0.7, 2.5, 0.05],
  depthGap: [0.7, 2.5, 0.05],
  stateRingGap: [0.9, 2, 0.01],
  stateBlobSize: [0.75, 3, 0.05],
  stateBlobJoin: [0.05, 0.9, 0.05],
  stateAngularGap: [0.9, 2, 0.01],
  stagger: [0, 1, 0.05],
  recordGap: [0.5, 3, 0.05],
  recordRingGap: [0.75, 2.5, 0.05],
  recordAngularGap: [0.6, 2, 0.05],
  recordSpread: [0, 45, 1],
  recordPercent: [1, 100, 1],
  recordSize: [0.3, 1.5, 0.05],
  recordOpacity: [0.1, 1, 0.05],
} as const;
export type NumericSetting = keyof typeof ranges;
export type HubSettings = Record<NumericSetting, number> & {
  version: 1;
  graphSource: "repo" | "random" | "procedural";
  repoPath: string;
  packing: "rings" | "compact" | "disc";
  organic: boolean;
  theme: "dark" | "light";
  palette: keyof typeof colorPalettes;
  names: boolean;
  evidenceOutside: boolean;
  showRecords: boolean;
  recordPlacement: "anchored" | "even";
  recordOrder: "newest" | "oldest";
  ageColours: boolean;
  recordBlobs: boolean;
  preserveStateOutlines: boolean;
  preserveRecordOutlines: boolean;
  guides: boolean;
  citations: "focus" | "all" | "none";
};
export const defaultSettings: HubSettings = {
  version: 1,
  graphSource: "repo",
  repoPath: "",
  graphSeed: 42,
  graphStates: 50,
  graphRecords: 200,
  graphDepth: 3,
  graphBranches: 6,
  graphCitations: 2,
  packing: "compact",
  organic: false,
  theme: "dark",
  palette: "ocean",
  names: false,
  rootGap: 1.75,
  depthGap: 0.7,
  stateRingGap: 1.22,
  stateBlobSize: 1.05,
  stateBlobJoin: 0.75,
  stateAngularGap: 1.9,
  stagger: 0.3,
  evidenceOutside: true,
  recordGap: 1.25,
  recordRingGap: 1.25,
  recordAngularGap: 0.6,
  recordSpread: 5,
  showRecords: true,
  recordPercent: 100,
  recordPlacement: "anchored",
  recordOrder: "newest",
  recordSize: 1.15,
  recordOpacity: 1,
  ageColours: true,
  recordBlobs: true,
  preserveStateOutlines: true,
  preserveRecordOutlines: false,
  guides: true,
  citations: "focus",
};

export function applyPreset(
  settings: HubSettings,
  preset: StatePacking,
): HubSettings {
  const tight = preset === "compact-tight",
    roomy = preset === "compact-evidence-roomy";
  return {
    ...settings,
    packing: preset === "rings" || preset === "disc" ? preset : "compact",
    rootGap: tight ? 0.7 : roomy ? 1.15 : 1,
    depthGap: tight ? 0.7 : roomy ? 1.15 : 1,
    stateRingGap: tight ? 0.92 : roomy ? 1.2 : 1,
    stateAngularGap: tight ? 0.94 : roomy ? 1.2 : 1,
    stagger: preset === "compact-staggered" ? 0.5 : 0,
    evidenceOutside: preset === "compact-evidence" || roomy,
  };
}
export function parseSettings(raw: unknown): HubSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Choose a graph config JSON file.");
  const input = raw as Record<string, unknown>;
  if (input.version !== 1)
    throw new Error("This config version is not supported.");
  const result = { ...defaultSettings };
  if (input.repoPath !== undefined) {
    if (typeof input.repoPath !== "string" || input.repoPath.length > 4096) throw new Error("Invalid repository path.");
    result.repoPath = input.repoPath.trim();
  }
  for (const key of Object.keys(ranges) as NumericSetting[]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "number" || !Number.isFinite(input[key]))
      throw new Error(`Invalid ${key} value.`);
    const [min, max] = ranges[key];
    const value = Math.max(min, Math.min(max, input[key] as number));
    result[key] = key.startsWith("graph") ? Math.round(value) : value;
  }
  for (const key of [
    "organic",
    "names",
    "evidenceOutside",
    "showRecords",
    "ageColours",
    "recordBlobs",
    "preserveStateOutlines",
    "preserveRecordOutlines",
    "guides",
  ] as const) {
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      throw new Error(`Invalid ${key} value.`);
    if (typeof input[key] === "boolean") result[key] = input[key];
  }
  const choices = {
    graphSource: ["repo", "random", "procedural"],
    packing: ["rings", "compact", "disc"],
    theme: ["dark", "light"],
    palette: Object.keys(colorPalettes),
    recordPlacement: ["anchored", "even"],
    recordOrder: ["newest", "oldest"],
    citations: ["focus", "all", "none"],
  } as const;
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    if (input[key] === undefined) continue;
    if (!(choices[key] as readonly unknown[]).includes(input[key]))
      throw new Error(`Invalid ${key} value.`);
    Object.assign(result, { [key]: input[key] });
  }
  return result;
}
export function settingsFromUrl(search: string): HubSettings {
  const query = new URLSearchParams(search);
  if (query.has("config"))
    return parseSettings(JSON.parse(query.get("config")!));
  const packing = query.get("packing") as StatePacking;
  const settings = Object.hasOwn(presets, packing)
    ? applyPreset(defaultSettings, packing)
    : { ...defaultSettings };
  settings.organic = query.get("organic") === "1";
  settings.citations = settings.organic ? "all" : "focus";
  settings.theme = query.get("theme") === "light" ? "light" : "dark";
  return settings;
}
export function settingsUrl(settings: HubSettings, href: string): string {
  const url = new URL(href);
  for (const key of ["packing", "organic", "theme"])
    url.searchParams.delete(key);
  url.searchParams.set("layout", "hub");
  url.searchParams.set("config", JSON.stringify(settings));
  return url.href;
}

/** Sample slider steps and categorical controls; keep the schema version fixed. */
export function randomizeSettings(random: () => number = Math.random): HubSettings {
  const result = { ...defaultSettings };
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  for (const key of Object.keys(ranges) as NumericSetting[]) {
    if (key.startsWith("graph")) continue;
    const [min, max, step] = ranges[key];
    result[key] = Number((min + Math.floor(random() * (Math.round((max - min) / step) + 1)) * step).toFixed(2));
  }
  for (const key of Object.keys(result) as (keyof HubSettings)[]) {
    if (typeof result[key] === "boolean") Object.assign(result, { [key]: random() >= 0.5 });
  }
  result.packing = pick(["rings", "compact", "disc"]);
  result.theme = pick(["dark", "light"]);
  result.palette = pick(Object.keys(colorPalettes) as (keyof typeof colorPalettes)[]);
  result.recordPlacement = pick(["anchored", "even"]);
  result.recordOrder = pick(["newest", "oldest"]);
  result.citations = pick(["focus", "all", "none"]);
  return result;
}
