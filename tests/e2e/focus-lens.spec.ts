import { test, expect } from "@playwright/test";
import { generateDebugGraph, debugDefaults } from "../../src/debug-graphs";

test("focus lens drills down, keeps every node represented, and switches context branches", async ({
  page,
}) => {
  const graph = generateDebugGraph({
    ...debugDefaults,
    shape: "tree",
    lod: true,
    count: 1120,
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/graph?*", (route) =>
    route.fulfill({
      json: {
        ...graph,
        repo: "/synthetic/focus",
        source: "hypergraph",
        head: null,
        warnings: [],
      },
    }),
  );
  await page.goto("/?repo=/synthetic/focus&lens=1");
  const map = page.locator("svg.focus-map");
  await expect(map).toHaveAttribute("data-represented", "1120");
  const original = await map.getAttribute("data-focus");
  for (let step = 0; step < 10; step++) {
    if (await page.locator('[data-kind="node"][data-context="0"]').count())
      break;
    await page.locator('[data-kind="group"][data-context="0"]').first().click();
    await expect(map).toHaveAttribute("data-represented", "1120");
  }
  const node = page.locator('[data-kind="node"][data-context="0"]').first();
  await expect(node).toBeVisible();
  await node.focus();
  await node.press("Enter");
  await expect(page.locator(".atlas-selection")).toBeVisible();
  const previous = await map.getAttribute("data-focus");
  await page.locator('[data-kind="group"][data-context="1"]').first().click();
  await expect(map).not.toHaveAttribute("data-focus", previous!);
  await expect(map).toHaveAttribute("data-represented", "1120");
  await page
    .getByRole("button", { name: "Back to parent", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-represented", "1120");
  await page
    .getByRole("button", { name: "Whole graph", exact: true })
    .first()
    .click();
  await expect(map).toHaveAttribute("data-focus", original!);
  await page.getByLabel("All cross-links").check();
  await page.getByRole("link", { name: "Compare radial atlas" }).click();
  await expect(page.locator("canvas.atlas-canvas")).toHaveAttribute(
    "data-represented",
    "1120",
  );
  expect(errors).toEqual([]);
});

test("focus lens stays enabled while synthetic debug settings change", async ({
  page,
}) => {
  await page.goto("/?debug=1&lod=1&lens=1&shape=tree&count=10000");
  await expect(page.locator("svg.focus-map")).toHaveAttribute(
    "data-represented",
    "10000",
  );
  await page.getByLabel("Shape", { exact: true }).selectOption("chain");
  await expect(page.locator("svg.focus-map")).toHaveAttribute(
    "data-represented",
    "10000",
  );
  await expect(page).toHaveURL(/lens=1/);
});
