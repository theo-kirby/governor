/** Branch-local radial placement. Angles retain the forest's nested sectors;
 * congestion moves only the affected node and its descendants outward.
 */
export function compactRings(
  order: string[],
  tree: Map<string, string[]>,
  angles: Map<string, { angle: number }>,
  spacing: number,
  ringGap: number,
) {
  const parent = new Map<string, string>();
  for (const [id, children] of tree)
    for (const child of children) parent.set(child, id);
  const roots = order.filter((id) => !parent.has(id));
  const pitch = Math.max(spacing, ringGap * 0.65);
  const rings = new Map<number, number[]>();
  const depth = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of order) {
    const ancestor = parent.get(id);
    let ring = ancestor ? depth.get(ancestor)! + 1 : roots.length === 1 ? 0 : 1;
    const angle = angles.get(id)!.angle;
    // Keep the subtree's direction, even when there is spare room elsewhere.
    // A collision delays this branch, not the entire depth level.
    while (
      (rings.get(ring) || []).some(
        (other) =>
          2 * ring * pitch * Math.abs(Math.sin((angle - other) / 2)) <
          spacing - 1e-8,
      )
    )
      ring++;
    const occupants = rings.get(ring) || [];
    occupants.push(angle);
    rings.set(ring, occupants);
    depth.set(id, ring);
    const radius = ring * pitch;
    positions.set(id, {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }
  return positions;
}
