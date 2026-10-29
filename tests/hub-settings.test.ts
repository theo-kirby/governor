import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPreset,
  randomizeSettings,
  ranges,
  defaultSettings,
  parseSettings,
  settingsFromUrl,
  settingsUrl,
} from "../src/hub-settings";

test("configs round-trip without graph data and preserve unrelated URL parameters", () => {
  const settings = {
    ...applyPreset(defaultSettings, "compact-evidence-roomy"),
    recordOpacity: 0.4,
    recordSpread: 18,
    names: true,
  };
  const url = new URL(
    settingsUrl(
      settings,
      "http://localhost:4311/?repo=/fixture&packing=disc&source=test",
    ),
  );
  assert.equal(url.searchParams.get("repo"), "/fixture");
  assert.equal(url.searchParams.get("source"), "test");
  assert.equal(url.searchParams.has("packing"), false);
  assert.deepEqual(settingsFromUrl(url.search), settings);
  assert.deepEqual(
    parseSettings(JSON.parse(JSON.stringify(settings))),
    settings,
  );
});
test("legacy preset links resolve to editable controls", () => {
  const settings = settingsFromUrl(
    "?packing=compact-evidence-roomy&organic=1&theme=light",
  );
  assert.equal(settings.packing, "compact");
  assert.equal(settings.evidenceOutside, true);
  assert.equal(settings.stateRingGap, 1.2);
  assert.equal(settings.rootGap, 1.15);
  assert.equal(settings.citations, "all");
});
test("import rejects invalid types and versions and bounds expensive settings", () => {
  assert.throws(() => parseSettings({ version: 2 }));
  assert.throws(() => parseSettings({ version: 1, showRecords: "false" }));
  assert.throws(() => parseSettings({ version: 1, packing: "unknown" }));
  assert.throws(() => parseSettings({ version: 1, recordRingGap: NaN }));
  const parsed = parseSettings({
    version: 1,
    recordRingGap: -1,
    recordPercent: 10000,
    recordSpread: 900,
    nodes: ["private"],
  });
  assert.equal(parsed.recordRingGap, 0.75);
  assert.equal(parsed.recordPercent, 100);
  assert.equal(parsed.recordSpread, 45);
  assert.equal("nodes" in parsed, false);
});

test("bare hub URLs use the chosen default rather than resetting to a legacy preset", () => {
  assert.deepEqual(settingsFromUrl("?layout=hub"), defaultSettings);
  assert.deepEqual(settingsFromUrl(""), defaultSettings);
  assert.deepEqual(settingsFromUrl("?packing=unknown"), defaultSettings);
  const themed = settingsFromUrl("?theme=light");
  assert.deepEqual(themed, { ...defaultSettings, theme: "light" });
  const explicit = settingsFromUrl("?packing=rings");
  assert.equal(explicit.packing, "rings");
  assert.equal(explicit.rootGap, 1);
});

 test("random configs stay valid at slider steps and palettes round-trip", () => {
  for (const value of [0, 0.25, 0.5, 0.999999]) {
    const settings = randomizeSettings(() => value);
    assert.deepEqual(parseSettings(settings), settings);
    assert.deepEqual(settingsFromUrl(new URL(settingsUrl(settings, "http://localhost/")).search), settings);
    for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
      const [min, , step] = ranges[key];
      const steps = (settings[key] - min) / step;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-8);
    }
  }
  assert.equal(parseSettings({version: 1}).palette, "ocean");
  assert.throws(() => parseSettings({version: 1, palette: "unknown"}));
});
