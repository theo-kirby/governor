import { test, expect } from "@playwright/test";
import { generateDebugGraph, debugDefaults } from "../../src/debug-graphs";
import { riverLayout } from "../../src/rivers";

test("rivers fit every node, trace a selection, and retain the radial comparison", async ({
  page,
}) => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    shape: "chain",
    count: 1120,
    lod: true,
  });
  const layout = riverLayout(graph.nodes, graph.edges, {
    fold: 10,
    ranker: "network-simplex",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/graph?*", (route) =>
    route.fulfill({
      json: {
        ...graph,
        repo: "/synthetic",
        head: null,
        source: "hypergraph",
        warnings: [],
      },
    }),
  );
  await page.goto("/?repo=/synthetic&rivers=1");
  const canvas = page.locator("canvas.river-canvas");
  await expect(canvas).toHaveAttribute("data-drawn", "1120");
  const zoom = Number(await canvas.getAttribute("data-zoom"));
  const p = layout.positions.get(graph.nodes[0].id)!;
  await canvas.click({
    position: {
      x: p.x * zoom + Number(await canvas.getAttribute("data-camera-x")),
      y: p.y * zoom + Number(await canvas.getAttribute("data-camera-y")),
    },
  });
  await expect(canvas).toHaveAttribute("data-selected", graph.nodes[0].id);
  await canvas.press("Escape");
  await expect(canvas).toHaveAttribute("data-selected", "");
  await page.getByLabel("Cross-links").selectOption("all");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect(Number(await canvas.getAttribute("data-zoom"))).toBeGreaterThan(zoom);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-drawn", "1120");
  await page.getByLabel("Thread fold").fill("20");
  await expect(canvas).toHaveAttribute("data-drawn", "1120");
  await page.getByRole("link", { name: "Compare radial" }).click();
  await expect(page.locator("canvas.river-canvas")).toHaveCount(0);
  await expect(page.locator(".graph-canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("debug changes preserve rivers mode", async ({ page }) => {
  await page.goto("/?debug=1&rivers=1&shape=chain&count=40");
  const canvas = page.locator("canvas.river-canvas");
  await expect(canvas).toHaveAttribute("data-drawn", "40");
  await page.getByLabel("Ranker").selectOption("longest-path");
  await expect(canvas).toHaveAttribute("data-drawn", "40");
  await page.reload();
  await expect(canvas).toHaveAttribute("data-drawn", "40");
});
