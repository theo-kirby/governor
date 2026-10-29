import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("hub sidebar edits, shares and restores settings while keeping details and mobile access", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { defaultRepo: "/fixture", defaultParams: "layout=hub" },
    }),
  );
  const makeNode = (id: string, kind: string) => ({
    id,
    title: id === "root" ? "Synthetic memory" : id,
    parentId: null,
    childCount: 0,
    edgeCount: 0,
    lifecycle: "live",
    tags: [{ id: `graph:${kind}`, name: kind }],
  });
  await page.route("**/api/graph?*", (route) =>
    route.fulfill({
      json: {
        repo: "/fixture",
        head: null,
        warnings: [],
        nodes: [
          makeNode("root", "root"),
          makeNode("claim", "state"),
          makeNode("record", "record"),
        ],
        edges: [
          { id: "p", source: "root", target: "claim", kind: "containment" },
          {
            id: "c",
            source: "claim",
            target: "record",
            kind: "semantic",
            relation: "citation",
          },
        ],
      },
    }),
  );
  await page.route("**/api/node?*", (route) =>
    route.fulfill({
      json: {
        id: "root",
        title: "Synthetic memory",
        content: "Verified node body",
        refs: {},
      },
    }),
  );
  await page.goto(
    "/?layout=hub&packing=compact-evidence-roomy&theme=light&organic=1",
  );
  const canvas = page.locator("canvas");
  await expect(canvas).toHaveAttribute("data-nodes", "3");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator(".node-panel")).toContainText("Verified node body");
  await page.keyboard.press("Escape");
  await page.getByLabel("Show names", { exact: true }).check();
  await canvas.focus();
  await page.keyboard.press("n");
  await expect(
    page.getByLabel("Show names", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("slider", { name: "State ring spacing", exact: true }),
  ).toHaveValue("1.2");
  await page
    .getByRole("slider", { name: "State ring spacing", exact: true })
    .fill("1.5");
  await page
    .getByRole("slider", { name: "Record opacity", exact: true })
    .fill("0.4");
  await page
    .getByRole("combobox", { name: "Record placement", exact: true })
    .selectOption("even");
  await page.getByLabel("Show records", { exact: true }).uncheck();
  await expect(canvas).toHaveAttribute("data-nodes", "2");
  await page.getByLabel("Show records", { exact: true }).check();
  await expect(canvas).toHaveAttribute("data-nodes", "3");
  await page
    .getByRole("slider", { name: "State region size", exact: true })
    .fill("1.8");
  await page
    .getByRole("slider", { name: "State connection width", exact: true })
    .fill("0.75");
  await page.getByLabel("Preserve state outlines", { exact: true }).check();
  await page.getByLabel("Preserve record outlines", { exact: true }).check();
  await page.getByRole("button", { name: "Copy config", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Configuration status" }),
  ).toHaveText("Config copied.");
  const copied = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(copied.preserveStateOutlines).toBe(true);
  expect(copied.preserveRecordOutlines).toBe(true);
  expect(copied.stateBlobSize).toBe(1.8);
  expect(copied.stateBlobJoin).toBe(0.75);
  expect(copied.stateRingGap).toBe(1.5);
  expect(copied.recordOpacity).toBe(0.4);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).searchParams.has("config")).toBe(true);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save config", exact: true }).click();
  const download = await downloaded;
  const saved = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(saved).toEqual(copied);
  await page
    .getByRole("slider", { name: "Record opacity", exact: true })
    .fill("0.8");
  await page.getByLabel("Config file", { exact: true }).setInputFiles({
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(
    page.getByRole("slider", { name: "Record opacity", exact: true }),
  ).toHaveValue("0.4");
  await page.getByLabel("Config file", { exact: true }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(
    page.getByRole("status", { name: "Configuration status" }),
  ).toContainText("not supported");
  await page.goto(link);
  await expect(
    page.getByLabel("Preserve state outlines", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Preserve record outlines", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("slider", { name: "State ring spacing", exact: true }),
  ).toHaveValue("1.5");
  await expect(
    page.getByRole("combobox", { name: "Record placement", exact: true }),
  ).toHaveValue("even");
  await page
    .getByRole("button", { name: "Hide settings", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Graph settings" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("complementary", { name: "Graph settings" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Fit graph", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("slider", { name: "Record opacity", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("slider", { name: "Record opacity", exact: true }),
  ).toBeInViewport();
  await page.getByRole("combobox", { name: "Color palette", exact: true }).selectOption("sunset");
  await expect.poll(() => new URL(page.url()).searchParams.get("config")).toContain('"palette":"sunset"');
  const previous = new URL(page.url()).searchParams.get("config");
  await page.getByRole("button", { name: "Randomize config", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("config")).not.toBe(previous);
  await page.getByRole("button", { name: "Undo randomize", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("config")).toBe(previous);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Color palette", exact: true })).toHaveValue("sunset");
  await page.screenshot({ path: "/tmp/governor-sidebar-mobile.png" });
  await page.getByRole("combobox", {name: "Graph source", exact: true}).selectOption("procedural");
  await page.getByRole("slider", {name: "State count", exact: true}).fill("12");
  await page.getByRole("slider", {name: "Record count", exact: true}).fill("20");
  await expect(canvas).toHaveAttribute("data-nodes", "33");
  await page.reload();
  await expect(canvas).toHaveAttribute("data-nodes", "33");
  await page.getByRole("button", {name: "Settings", exact: true}).click();
  await expect(page.getByRole("combobox", {name: "Graph source", exact: true})).toHaveValue("procedural");
  await page.getByRole("combobox", {name: "Graph source", exact: true}).selectOption("random");
  await expect(page.getByRole("button", {name: "Regenerate graph", exact: true})).toBeVisible();
  await page.getByRole("combobox", {name: "Graph source", exact: true}).selectOption("repo");
  await expect(canvas).toHaveAttribute("data-nodes", "3");
  await page.getByRole("textbox", {name: "Repository path", exact: true}).fill("/another-fixture");
  await page.getByRole("button", {name: "Load repository", exact: true}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("config")).toContain('"repoPath":"/another-fixture"');
  await expect(canvas).toHaveAttribute("data-nodes", "3");
  expect(errors).toEqual([]);
});
