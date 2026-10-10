import { test, expect } from "@playwright/test";
import type { GraphNode, GraphEdge } from "../../shared/types";

test("large radial graphs fit on load, refit on resize and support manual exploration", async ({
  page,
}) => {
  const nodes: GraphNode[] = Array.from({ length: 1120 }, (_, i) => ({
    id: `n${i}`,
    title: `Research node ${i}`,
    parentId: i ? `n${i < 100 ? 0 : i - 1}` : null,
    childCount: i < 1119 ? 1 : 0,
    edgeCount: 0,
    lifecycle: "live",
  }));
  const edges: GraphEdge[] = nodes.slice(1).map((n) => ({
    id: `edge:${n.id}`,
    source: n.parentId!,
    target: n.id,
    kind: "containment",
  }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/graph?*", (route) =>
    route.fulfill({
      json: {
        nodes,
        edges,
        repo: "/synthetic",
        source: "hypergraph",
        head: null,
        warnings: [],
      },
    }),
  );
  await page.goto("/?repo=/synthetic&chains=0&branchesCollapsed=0");
  const graph = page.locator(".graph-canvas");
  await expect(graph).toHaveAttribute("data-visible-nodes", "1120");
  const initial = Number(await graph.getAttribute("data-zoom"));
  await graph.focus();
  await page.keyboard.press("+");
  await expect
    .poll(async () => Number(await graph.getAttribute("data-zoom")))
    .toBeGreaterThan(initial);
  await page.keyboard.press("f");
  await expect(graph).toHaveAttribute("data-visible-nodes", "1120");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => Number(await graph.getAttribute("data-zoom")))
    .toBeLessThan(initial);
  await expect(graph).toHaveAttribute("data-visible-nodes", "1120");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(graph).toHaveAttribute("data-visible-nodes", "1120");
  expect(errors).toEqual([]);
});

test("thousand-node playground switches fixtures, seeds, layout and role encoding", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "/?debug=1&shape=research&count=1000&seed=7&crossLinks=1&chains=0&branchesCollapsed=0",
  );
  const graph = page.locator(".graph-canvas");
  await expect(graph).toHaveAttribute("data-visible-nodes", "1000");
  await page.getByLabel("Role colors and shapes").check();
  await expect(page).toHaveURL(/appearance=roles/);
  await page.getByRole("button", { name: "Next seed" }).click();
  await expect(page).toHaveURL(/seed=8/);
  await page
    .getByLabel("Ring layout", { exact: true })
    .selectOption("adaptive");
  await expect(page).toHaveURL(/rings=adaptive/);
  await expect(graph).toHaveAttribute("data-visible-nodes", "1000");
  await page.getByLabel("Ring layout", { exact: true }).selectOption("compact");
  for (const shape of ["burst", "teams", "random", "star", "chain"]) {
    await page.getByLabel("Shape", { exact: true }).selectOption(shape);
    await expect(graph).toHaveAttribute("data-visible-nodes", "1000");
  }
  await page.reload();
  await expect(page.getByLabel("Shape", { exact: true })).toHaveValue("chain");
  await expect(graph).toHaveAttribute("data-visible-nodes", "1000");
  expect(errors).toEqual([]);
});

test("chain marker keeps endpoints, expands on click and collapses with C", async ({
  page,
}) => {
  await page.goto(
    "/?debug=1&shape=chain&count=1000&tagRate=0&branchesCollapsed=0",
  );
  const graph = page.locator(".graph-canvas");
  await expect(graph).toHaveAttribute("data-nodes", "3");
  await expect(graph).toHaveAttribute("data-original-nodes", "1000");
  await expect(graph).toHaveAttribute("data-collapsed-chains", "1");
  // The three-node chain is centered vertically; the marker is its middle node.
  const bounds = (await graph.boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2 - 12,
  );
  await expect(graph).toHaveAttribute("data-nodes", "1000");
  await expect(graph).toHaveAttribute("data-collapsed-chains", "0");
  await graph.focus();
  await page.keyboard.press("c");
  await expect(graph).toHaveAttribute("data-nodes", "3");
  await page.getByLabel("Collapse linear chains").uncheck();
  await expect(graph).toHaveAttribute("data-nodes", "1000");
  await page.reload();
  await expect(graph).toHaveAttribute("data-nodes", "1000");
});

test("nested branch summaries open a wide tree one level at a time", async ({
  page,
}) => {
  await page.goto("/?debug=1&shape=star&count=1000&tagRate=0");
  const graph = page.locator(".graph-canvas");
  await expect(graph).toHaveAttribute("data-nodes", "6");
  await expect(graph).toHaveAttribute("data-original-nodes", "1000");
  const bounds = (await graph.boundingBox())!;
  // Root + five equal sectors, using the original radial layout at zoom 1.
  // Fit centers the asymmetric five-leaf bounds; include the label's height.
  await page.mouse.click(
    bounds.x + bounds.width / 2 + 180 * Math.cos(-Math.PI / 2 + Math.PI / 5),
    bounds.y + bounds.height / 2 - 180 * 0.904508497 - 12,
  );
  await expect(graph).toHaveAttribute("data-nodes", "11");
  await expect(graph).toHaveAttribute("data-visible-nodes", "11");
  await graph.focus();
  await page.keyboard.press("c");
  await expect(graph).toHaveAttribute("data-nodes", "6");
  await page.getByLabel("Nest branch summaries").uncheck();
  await expect(graph).toHaveAttribute("data-nodes", "1000");
});
