import { test, expect } from "@playwright/test";
import { generateDebugGraph, debugDefaults } from "../../src/debug-graphs";
import { projectFlywheel, layoutFlywheel } from "../../src/flywheel-model";

test("Flywheel study folds, expands, searches, pans, zooms, and refits without browser errors", async ({
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
        source: "hypergraph",
        head: null,
        warnings: [],
      },
    }),
  );
  await page.goto("/?repo=/fixture&renderer=flywheel");
  const canvas = page.locator(".fw-canvas");
  await expect(canvas).toHaveAttribute("data-nodes", "3");
  await expect(canvas).toHaveAttribute("data-original-nodes", "1000");
  const projection = projectFlywheel(graph.nodes, graph.edges),
    layout = layoutFlywheel(projection.nodes, projection.edges);
  const id = [...projection.groups.keys()][0],
    p = layout.positions.get(id)!;
  const scale = Math.min(1320, 820) / (2 * layout.extent);
  await canvas.click({
    position: { x: 720 + p.x * scale, y: 515 + p.y * scale },
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
  await page.getByRole("button", { name: "FIT GRAPH", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-visible-nodes", "3");
  await page.getByRole("button", { name: "VIEW", exact: true }).click();
  await page.getByLabel("Fold runs & leaf fans").uncheck();
  await expect(canvas).toHaveAttribute("data-nodes", "1000");
  await page.getByLabel("Find a node").fill(graph.nodes[0].title);
  await page.locator(".fw-result").first().click();
  await expect(page.getByLabel("Selected node")).toBeVisible();
  await page.getByRole("button", { name: "Close node", exact: true }).click();
  await page.getByLabel("Orbital guides").uncheck();
  await page.getByLabel("Citation edges").uncheck();
  await page.getByLabel("Fold runs & leaf fans").check();
  await page.getByRole("button", { name: "VIEW", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toHaveAttribute("data-visible-nodes", "3");
  expect(errors).toEqual([]);
});

test("large fixtures keep the replica renderer when changing seeds and shapes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "/?renderer=flywheel&debug=1&shape=research&count=1000&seed=7",
  );
  const canvas = page.locator(".fw-canvas");
  await expect(canvas).toHaveAttribute("data-original-nodes", "1000");
  await page.getByRole("button", { name: "Next seed" }).click();
  await expect(page).toHaveURL(/renderer=flywheel/);
  await page.getByLabel("Shape", { exact: true }).selectOption("star");
  await expect(canvas).toHaveAttribute("data-nodes", "2");
  await page.getByLabel("Shape", { exact: true }).selectOption("teams");
  await expect(canvas).toHaveAttribute("data-components", "3");
  await expect(canvas).toHaveAttribute("data-visible-nodes", "9");
  expect(errors).toEqual([]);
});
