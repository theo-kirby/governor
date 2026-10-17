import { test, expect } from "@playwright/test";
import { generateDebugGraph, debugDefaults } from "../../src/debug-graphs";
import { projectFlywheel, layoutFlywheel } from "../../src/flywheel-model";

test("Default dotted-ring viewer folds, expands, pans, zooms, and refits without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const graph = generateDebugGraph({
    ...debugDefaults,
    shape: "chain",
    count: 1000,
    crossLinks: false,
  });
  await page.route("**/api/graph?*", (route) =>
    route.fulfill({
      json: {
        ...graph,
        repo: "/fixture",
        head: null,
        warnings: [],
      },
    }),
  );
  await page.goto("/?repo=/fixture");
  const canvas = page.locator(".fw-canvas");
  await expect(canvas).toHaveAttribute("data-nodes", "3");
  await expect(canvas).toHaveAttribute("data-original-nodes", "1000");
  const projection = projectFlywheel(graph.nodes, graph.edges),
    layout = layoutFlywheel(projection.nodes, projection.edges);
  const id = [...projection.groups.keys()][0],
    p = layout.positions.get(id)!;
  const scale = Math.min(1.5, Math.min(1344, 904) / (2 * layout.extent));
  await canvas.click({
    position: { x: 720 + p.x * scale, y: 500 + p.y * scale },
  });
  await expect(canvas).toHaveAttribute("data-nodes", "1000");
  await canvas.focus();
  await page.keyboard.press("c");
  await expect(canvas).toHaveAttribute("data-nodes", "3");
  const initial = Number(await canvas.getAttribute("data-zoom"));
  await page.keyboard.press("+");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-zoom")))
    .toBeGreaterThan(initial);
  await page.keyboard.press("f");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-zoom")))
    .toBeCloseTo(initial);
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(900, 500, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("f");
  await expect(canvas).toHaveAttribute("data-visible-nodes", "3");
  await canvas.click({ position: { x: 720, y: 500 } });
  await expect(page.locator("header, footer, nav")).toHaveCount(0);
  await expect(page.locator(".fw-study").locator(":scope > *")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-ring-style", "dotted");
  await expect(page.locator("aside, select")).toHaveCount(0);
  await page.keyboard.press("r");
  await expect(canvas).toHaveAttribute("data-ring-style", "dotted");
  await page.reload();
  await expect(canvas).toHaveAttribute("data-ring-style", "dotted");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toHaveAttribute("data-visible-nodes", "3");
  expect(errors).toEqual([]);
});

test("large fixtures keep the replica renderer when changing seeds and shapes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?debug=1&shape=research&count=1000&seed=7");
  const canvas = page.locator(".fw-canvas");
  await expect(canvas).toHaveAttribute("data-original-nodes", "1000");
  await page.getByRole("button", { name: "Next seed" }).click();
  await expect(canvas).toHaveAttribute("data-ring-style", "dotted");
  await page.getByLabel("Shape", { exact: true }).selectOption("star");
  await expect(canvas).toHaveAttribute("data-nodes", "2");
  await page.getByLabel("Shape", { exact: true }).selectOption("teams");
  await expect(canvas).toHaveAttribute("data-components", "3");
  await expect(canvas).toHaveAttribute("data-visible-nodes", "9");
  expect(errors).toEqual([]);
});

test("old experiment URLs resolve to the dotted-ring viewer", async ({
  page,
}) => {
  await page.goto("/?demo&renderer=radial&ringStyle=mist&rings=adaptive");
  await expect(page.locator(".fw-canvas")).toHaveAttribute(
    "data-ring-style",
    "dotted",
  );
  await expect(page.locator(".graph-canvas, .fw-ring-panel")).toHaveCount(0);
});
