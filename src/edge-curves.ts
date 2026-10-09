type Point = { x: number; y: number };

/** Cytoscape's signed perpendicular offset, pointing away from the radial origin. */
export function outwardBend(source: Point, target: Point): number {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (!length) return 0;
  const midpoint = {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2,
  };
  const outward = (-dy * midpoint.x + dx * midpoint.y) / length;
  // A spoke through the center has no outward side; keep it radial, not spiraled.
  if (Math.abs(outward) < 1e-6) return 0;
  return Math.sign(outward) * Math.max(28, Math.min(100, length * 0.18));
}
