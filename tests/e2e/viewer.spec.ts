import { test, expect } from "@playwright/test";
import type { Snapshot } from "../../shared/types";
const root = "11111111-1111-4111-8111-111111111111";
const record = "22222222-2222-4222-8222-222222222222";
const state = "33333333-3333-4333-8333-333333333333";
const note = "44444444-4444-4444-8444-444444444444";
const evidence = "55555555-5555-4555-8555-555555555555";
const snapshot: Snapshot = {
  repo: "/synthetic/research",
  repositoryId: "synthetic",
  head: `sha256:${"a".repeat(64)}`,
  stagedOperations: 2,
  loadedAt: "2026-01-01T00:00:00Z",
  nodes: [
    {
      id: root,
      title: "Research",
      parentId: null,
      childCount: 2,
      edgeCount: 0,
      lifecycle: "live",
    },
    {
      id: record,
      title: "Record",
      parentId: root,
      childCount: 2,
      edgeCount: 1,
      lifecycle: "live",
    },
    {
      id: state,
      title: "State",
      parentId: root,
      childCount: 0,
      edgeCount: 0,
      lifecycle: "live",
    },
    {
      id: note,
      title: "Experiment A",
      parentId: record,
      childCount: 0,
      edgeCount: 0,
      lifecycle: "live",
    },
    {
      id: evidence,
      title: "Evidence B",
      parentId: record,
      childCount: 0,
      edgeCount: 0,
      lifecycle: "live",
    },
  ],
  edges: [
    { id: "c1", source: root, target: record, kind: "containment" },
    { id: "c2", source: root, target: state, kind: "containment" },
    { id: "c3", source: record, target: note, kind: "containment" },
    { id: "c4", source: record, target: evidence, kind: "containment" },
    {
      id: "s1",
      source: note,
      target: evidence,
      kind: "semantic",
      scope: record,
      content: "Synthetic relationship",
    },
  ],
};

test("automatically renders the orbital canvas", async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  let graphReads = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      !request
        .url()
        .startsWith(process.env.VIEWER_URL || "http://127.0.0.1:5173")
    )
      external.push(request.url());
  });
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { defaultRepo: "/synthetic/research" } }),
  );
  await page.route("**/api/graph?*", (route) => {
    graphReads++;
    expect(new URL(route.request().url()).searchParams.get("repo")).toBe(
      "/synthetic/research",
    );
    expect(route.request().headers()["x-flywheel-viewer"]).toBe("1");
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  const graph = page.locator(".fw-canvas");
  await expect(graph).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(
    page.locator("header, aside, nav, button, input, a, h1, h2"),
  ).toHaveCount(0);
  expect(await page.locator("body").innerText()).toBe("");
  expect(
    await page
      .locator(".graph-screen")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(0, 0, 0)");
  await expect
    .poll(async () =>
      page.locator("canvas").evaluateAll((canvases) => {
        let drawn = 0;
        for (const canvas of canvases as HTMLCanvasElement[]) {
          const pixels = canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          if (!pixels) continue;
          for (let i = 0; i < pixels.length; i += 4) {
            if (!pixels[i + 3]) continue;
            if (pixels[i] > 40) drawn++;
          }
        }
        return drawn;
      }),
    )
    .toBeGreaterThan(0);
  await graph.focus();
  const before = await page.screenshot();
  await page.keyboard.press("+");
  await expect
    .poll(async () => Buffer.compare(await page.screenshot(), before))
    .not.toBe(0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("f");
  await page.reload();
  await expect(page.locator(".fw-canvas")).toBeVisible();
  expect(graphReads).toBeGreaterThan(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await graph.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 390,
    height: 844,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth === innerWidth &&
        document.documentElement.scrollHeight === innerHeight,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("URL repository loads directly without configuration or a picker", async ({
  page,
}) => {
  await page.route("**/api/config", () => {
    throw new Error("Explicit URL should bypass config");
  });
  await page.route("**/api/graph?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("repo")).toBe(
      query.has("tags") ? snapshot.repo : "../example/.flywheel",
    );
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/?repo=../example/.flywheel");
  await expect(page.locator(".fw-canvas")).toBeVisible();
});

test("failed reads leave a blank black screen and report the error in the console", async ({
  page,
}) => {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") messages.push(message.text());
  });
  await page.route("**/api/graph?*", (route) =>
    route.fulfill({
      status: 400,
      json: { error: "No Flywheel repository found here." },
    }),
  );
  await page.goto("/?repo=/missing");
  await expect(
    page.getByRole("main", { name: "Graph unavailable" }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).toBe("");
  await expect(page.locator("canvas, button, input")).toHaveCount(0);
  expect(
    messages.some((message) =>
      message.includes("No Flywheel repository found here."),
    ),
  ).toBe(true);
});

test("demo is a standalone template and does not access a real repository", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  await page.addInitScript(() =>
    localStorage.setItem("flywheel-viz:repo", "/synthetic/remembered"),
  );
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?demo&repo=/synthetic/ignored");
  await expect(page.locator(".fw-canvas")).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  expect(await page.locator("body").innerText()).toBe("");
  expect(
    await page.evaluate(() => localStorage.getItem("flywheel-viz:repo")),
  ).toBe("/synthetic/remembered");
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("an unconfigured viewer opens the demo automatically", async ({
  page,
}) => {
  const graphRequests: string[] = [];
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { defaultRepo: "" } }),
  );
  page.on("request", (request) => {
    if (request.url().includes("/api/graph")) graphRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator(".fw-canvas")).toBeVisible();
  expect(graphRequests).toEqual([]);
});

test("debug controls switch stress cases, tune the layout, and preserve reproducible URLs without repository reads", async ({
  page,
}) => {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.goto("/?debug&chains=0");
  await expect(
    page.getByRole("complementary", { name: "Graph debug controls" }),
  ).toBeVisible();
  await expect(page.locator(".fw-canvas")).toBeVisible();
  await page.getByLabel("Shape", { exact: true }).selectOption("tree");
  await page.getByLabel("Nodes", { exact: true }).fill("24");
  await page.getByLabel("Branches / islands").fill("4");
  await expect(page.locator(".fw-canvas")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Nodes", { exact: true })).toHaveValue("24");
  for (const shape of [
    "chain",
    "star",
    "lopsided",
    "diamond",
    "cycle",
    "islands",
    "dense",
    "loops",
  ]) {
    await page.getByLabel("Shape", { exact: true }).selectOption(shape);
    await expect(page.locator(".fw-canvas")).toHaveAttribute(
      "data-original-nodes",
      "24",
    );
  }
  await page.getByLabel("Shape", { exact: true }).selectOption("single");
  await expect(page.locator(".fw-canvas")).toBeVisible();
  await page.getByLabel("Shape", { exact: true }).selectOption("empty");
  await expect(page.locator(".fw-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".fw-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Collapse debug controls" }).click();
  await expect(page.getByLabel("Shape", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand debug controls" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Shape", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test("random preset supports seeds and tagged coverage with URL replay", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?debug&shape=random&count=30&seed=7&tagRate=1&chains=0");
  await expect(page.locator(".fw-canvas")).toBeVisible();
  await expect(
    page.getByLabel("Add cross-links", { exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("Add cross-links", { exact: true }).check();
  await expect(page.getByLabel("Link density", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next seed", exact: true }).click();
  await expect(page.getByLabel("Seed", { exact: true })).toHaveValue("8");
  await page.reload();
  await expect(page.getByLabel("Seed", { exact: true })).toHaveValue("8");
  await expect(
    page.getByLabel("Add cross-links", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Tagged fraction", { exact: true }).fill("0");
  await expect(page.locator(".fw-canvas")).toHaveAttribute(
    "data-tagged-nodes",
    "0",
  );
  expect(errors).toEqual([]);
});

test("opens topology before tags and preserves the view after background loading", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/graph?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has("tags")) {
      expect(query.get("head")).toBe(snapshot.head);
      await waiting;
    }
    await route.fulfill({ json: snapshot });
  });
  await page.goto("/?repo=/synthetic/research");
  await expect(
    page.getByRole("main", {
      name: "Committed graph; loading tags",
      exact: true,
    }),
  ).toBeVisible();
  const graph = page.locator(".fw-canvas");
  await expect(page.locator("canvas").first()).toBeVisible();
  await graph.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowRight");
  const paintedBounds = () =>
    page.locator("canvas").evaluateAll((elements) => {
      let left = Infinity,
        top = Infinity,
        right = -Infinity,
        bottom = -Infinity;
      for (const canvas of elements as HTMLCanvasElement[]) {
        const pixels = canvas
          .getContext("2d")
          ?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (!pixels) continue;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] < 80 || pixels[i + 3] < 128) continue;
          const x = (i / 4) % canvas.width,
            y = Math.floor(i / 4 / canvas.width);
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      return [left, top, right, bottom];
    });
  await page.screenshot(); // Wait for a painted frame after keyboard navigation.
  const before = await paintedBounds();
  expect(before.every(Number.isFinite)).toBe(true);
  release();
  await expect(
    page.getByRole("main", { name: "Committed graph", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      await page.screenshot();
      const after = await paintedBounds();
      return Math.max(
        ...after.map((value, index) => Math.abs(value - before[index])),
      );
    })
    .toBeLessThanOrEqual(1);
});

test("renders live tag annotations from background enrichment", async ({
  page,
}) => {
  await page.route("**/api/graph?*", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has("tags")
        ? {
            ...snapshot,
            nodes: snapshot.nodes.map((node) => ({
              ...node,
              tags: [{ id: "active", name: "Active", scope: root }],
            })),
          }
        : snapshot,
    }),
  );
  await page.goto("/?repo=/synthetic/research");
  await expect(page.locator(".fw-canvas")).toHaveAttribute(
    "data-tagged-nodes",
    "5",
  );
});

test("legacy Hypergraph snapshots render without a Flywheel tag request", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/graph?*", (route) => {
    reads++;
    expect(new URL(route.request().url()).searchParams.has("tags")).toBe(false);
    return route.fulfill({
      json: { ...snapshot, source: "hypergraph", head: null },
    });
  });
  await page.goto("/?repo=../cadex");
  await expect(page.locator(".fw-canvas")).toBeVisible();
  await page.locator(".fw-canvas").focus();
  await page.keyboard.press("f");
  expect(reads).toBe(1);
});
