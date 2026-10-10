import { test, expect } from "@playwright/test";
import { generateDebugGraph, debugDefaults } from "../../src/debug-graphs";
import { buildAtlas, atlasFrontier } from "../../src/multiscale";

test("large repository opens as groups, drills into real nodes, and returns to the whole graph", async ({
  page,
}) => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    lod: true,
    shape: "tree",
    count: 1120,
  });
  const atlas = buildAtlas(graph.nodes, graph.edges);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/graph?*", (route) =>
    route.fulfill({
      json: {
        ...graph,
        repo: "/synthetic/large",
        source: "hypergraph",
        head: null,
        warnings: [],
      },
    }),
  );
  await page.goto("/?repo=/synthetic/large&lod=1");
  const canvas = page.locator("canvas.atlas-canvas");
  await expect(canvas).toHaveAttribute("data-represented", "1120");
  const initialZoom = Number(await canvas.getAttribute("data-zoom"));
  expect(Number(await canvas.getAttribute("data-groups"))).toBeGreaterThan(0);
  let reachedNodes = false;
  for (let step = 0; step < 8; step++) {
    const zoom = Number(await canvas.getAttribute("data-zoom"));
    const x = Number(await canvas.getAttribute("data-camera-x"));
    const y = Number(await canvas.getAttribute("data-camera-y"));
    const bounds = (await canvas.boundingBox())!;
    const frontier = atlasFrontier(atlas, zoom, 100);
    if (Number(await canvas.getAttribute("data-nodes")) > 0) {
      reachedNodes = true;
      break;
    }
    const region = frontier.items
      .filter((r) => !r.node)
      .find(
        (r) =>
          r.x * zoom + x > 100 &&
          r.x * zoom + x < bounds.width - 100 &&
          r.y * zoom + y > 80 &&
          r.y * zoom + y < bounds.height - 200,
      );
    expect(region).toBeTruthy();
    await canvas.dblclick({
      position: { x: region!.x * zoom + x, y: region!.y * zoom + y },
    });
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-zoom")))
      .toBeGreaterThan(zoom);
    await expect(canvas).toHaveAttribute("data-represented", "1120");
  }
  expect(reachedNodes).toBe(true);
  await page.getByLabel("Link visibility").selectOption("all");
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-zoom")))
    .toBeCloseTo(initialZoom, 5);
  await expect(canvas).toHaveAttribute("data-represented", "1120");
  expect(errors).toEqual([]);
});

test("10,000-node debug fixture and small demo share the atlas renderer", async ({
  page,
}) => {
  await page.goto("/?debug=1&lod=1&shape=tree&count=10000");
  const canvas = page.locator("canvas.atlas-canvas");
  await expect(canvas).toHaveAttribute("data-represented", "10000");
  await page.getByLabel("Level of detail").fill("320");
  await expect(canvas).toHaveAttribute("data-represented", "10000");
  await page.getByLabel("Neighborhood size").selectOption("16");
  await expect(canvas).toHaveAttribute("data-represented", "10000");
  await page.getByLabel("Multiscale experiment (up to 10,000 nodes)").uncheck();
  await expect(page.locator(".atlas-tools")).toHaveCount(0);
  await expect(page.getByRole("img")).toHaveAttribute(
    "aria-label",
    /200 nodes/,
  );
  await page.goto("/?demo=1&lod=1");
  await expect(canvas).toHaveAttribute("data-nodes", "16");
  await expect(canvas).toHaveAttribute("data-groups", "0");
});
