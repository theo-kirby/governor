import { summarizeFrontier, type Atlas, type Region } from "./multiscale";

/** The focus plus every sibling on its ancestor path partitions the whole graph.
 * Expanding one neighborhood never drops nodes from the surrounding context.
 */
export function focusFrontier(atlas: Atlas, focusId: string) {
  const focus = atlas.regions.get(focusId) || atlas.root;
  const detail = focus.node ? [focus] : focus.children;
  const context: Region[] = [];
  let current = focus;
  while (current.parent) {
    const parent = atlas.regions.get(current.parent)!;
    context.push(...parent.children.filter((child) => child !== current));
    current = parent;
  }
  return {
    ...summarizeFrontier(atlas, [...detail, ...context]),
    focus,
    detail,
    context,
  };
}

export function projectFocus(
  atlas: Atlas,
  focusId: string,
  width: number,
  height: number,
) {
  const frontier = focusFrontier(atlas, focusId);
  const points = new Map<string, { x: number; y: number; radius: number }>();
  const center = { x: width / 2, y: height / 2 };
  const orbit = Math.max(60, Math.min(width, height) / 2 - 65);
  const lens = Math.max(30, orbit - 100);
  const items = frontier.detail;
  const minX = Math.min(0, ...items.map((r) => r.x - frontier.focus.x));
  const maxX = Math.max(0, ...items.map((r) => r.x - frontier.focus.x));
  const minY = Math.min(0, ...items.map((r) => r.y - frontier.focus.y));
  const maxY = Math.max(0, ...items.map((r) => r.y - frontier.focus.y));
  const offset = {
    x: frontier.focus.x + (minX + maxX) / 2,
    y: frontier.focus.y + (minY + maxY) / 2,
  };
  const extent = Math.max(
    1,
    ...items.map((r) => Math.hypot(r.x - offset.x, r.y - offset.y)),
  );
  const scale = Math.max(1, lens - 45) / extent;
  for (const item of items) {
    const nearest = Math.min(
      Infinity,
      ...items
        .filter((other) => other !== item)
        .map((other) => Math.hypot(item.x - other.x, item.y - other.y) * scale),
    );
    points.set(item.id, {
      x: center.x + (item.x - offset.x) * scale,
      y: center.y + (item.y - offset.y) * scale,
      radius: Math.max(2, Math.min(item.node ? 16 : 34, nearest * 0.3)),
    });
  }
  // Context follows ancestor order; it remains entirely visible at every depth.
  const count = frontier.context.length;
  frontier.context.forEach((item, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    points.set(item.id, {
      x: center.x + Math.cos(angle) * orbit,
      y: center.y + Math.sin(angle) * orbit,
      radius: Math.max(
        2,
        Math.min(25, orbit * Math.sin(Math.PI / Math.max(2, count)) * 0.7),
      ),
    });
  });
  return { ...frontier, points, center, lens, orbit };
}
