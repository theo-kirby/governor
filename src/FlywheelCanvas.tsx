import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "../shared/types";
import { layoutFlywheel, projectFlywheel, type Point } from "./flywheel-model";
import "./flywheel.css";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const tagColor = (id: string) => {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 60% 58%)`;
};
const ringStyles = [
  "arcs",
  "ticks",
  "bands",
  "mist",
  "ribbons",
  "terraces",
  "soft",
  "dotted",
  "dashed",
  "none",
] as const;
type RingStyle = (typeof ringStyles)[number];
const styleNames: Record<RingStyle, string> = {
  arcs: "Occupied arcs",
  ticks: "Orbital ticks",
  bands: "Soft bands",
  mist: "Mist bands",
  ribbons: "Ribbon edges",
  terraces: "Terraced bands",
  soft: "Fine solid rings",
  dotted: "Dotted rings",
  dashed: "Dashed rings",
  none: "No guides",
};
const bandStyles = new Set<RingStyle>(["bands", "mist", "ribbons", "terraces"]);
const readLevel = (key: string, fallback: number, min: number, max: number) => {
  const raw = new URLSearchParams(location.search).get(key);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
};
type Camera = Point & { scale: number };
type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label?: string;
  onLayout?: (ms: number) => void;
};

export function FlywheelCanvas({ nodes, edges, onLayout }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [ringStyle, setRingStyle] = useState<RingStyle>(() => {
    const requested = new URLSearchParams(location.search).get("ringStyle");
    return ringStyles.includes(requested as RingStyle)
      ? (requested as RingStyle)
      : "dotted";
  });
  const [panelOpen, setPanelOpen] = useState(true);
  const [ink, setInk] = useState(() => readLevel("ringInk", 1, 0.25, 3));
  const [bandWidth, setBandWidth] = useState(() =>
    readLevel("bandWidth", 1, 0.4, 2),
  );
  const chooseStyle = (style: RingStyle) => {
    const url = new URL(location.href);
    url.searchParams.set("ringStyle", style);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    setRingStyle(style);
  };
  const changeLevel = (key: "ringInk" | "bandWidth", value: number) => {
    const url = new URL(location.href);
    url.searchParams.set(key, String(value));
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (key === "ringInk") setInk(value);
    else setBandWidth(value);
  };
  const [selected, setSelected] = useState<string | null>(null);
  const scene = useMemo(() => {
    const start = performance.now();
    const projected = projectFlywheel(nodes, edges, expanded);
    return {
      ...projected,
      ...layoutFlywheel(projected.nodes, projected.edges),
      milliseconds: performance.now() - start,
    };
  }, [nodes, edges, expanded]);
  useEffect(() => onLayout?.(scene.milliseconds), [scene, onLayout]);
  const options = useRef({ selected, ringStyle, ink, bandWidth });
  options.current = { selected, ringStyle, ink, bandWidth };
  const redraw = useRef(() => {});
  useEffect(() => redraw.current(), [selected, ringStyle, ink, bandWidth]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let width = 1,
      height = 1,
      frame = 0,
      disposed = false,
      hover: string | null = null;
    let camera: Camera = { x: 0, y: 0, scale: 1 };
    const positions = new Map(
      [...scene.positions].map(([id, p]) => [id, { ...p }]),
    );
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    // Membership follows the layout's generation; dragging only changes its angle.
    const occupied = new Map(
      scene.components.map((c) => {
        const rings = new Map(c.rings.map((r) => [r, [] as string[]]));
        for (const n of c.nodes) {
          const p = positions.get(n.id)!;
          const radius = Math.hypot(p.x - c.center.x, p.y - c.center.y);
          const r = c.rings.find((r) => Math.abs(r - radius) < 0.01);
          if (r !== undefined) rings.get(r)!.push(n.id);
        }
        return [c.id, rings] as const;
      }),
    );

    const roots = new Set(scene.components.flatMap((c) => c.roots));
    const adjacency = new Map(
      scene.nodes.map((n) => [n.id, new Set<string>()]),
    );
    for (const e of scene.edges) {
      adjacency.get(e.source)?.add(e.target);
      adjacency.get(e.target)?.add(e.source);
    }
    const point = (p: Point) => ({
      x: p.x * camera.scale + camera.x,
      y: p.y * camera.scale + camera.y,
    });
    const circle = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
    };
    const fit = (center: Point = { x: 0, y: 0 }, radius = scene.extent) => {
      camera.scale = clamp(
        Math.min(width - 96, height - 96) / (2 * radius),
        0.00001,
        1.5,
      );
      camera.x = width / 2 - center.x * camera.scale;
      camera.y = height / 2 - center.y * camera.scale;
      invalidate();
    };
    const zoomAt = (factor: number, x = width / 2, y = height / 2) => {
      const next = clamp(camera.scale * factor, 0.00001, 8),
        ratio = next / camera.scale;
      camera = {
        x: x - (x - camera.x) * ratio,
        y: y - (y - camera.y) * ratio,
        scale: next,
      };
      invalidate();
    };
    function draw() {
      frame = 0;
      if (disposed) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#131313";
      ctx.fillRect(0, 0, width, height);
      const opts = options.current,
        scale = camera.scale;
      const active = hover ?? opts.selected;
      const projectedActive = active
        ? (scene.owner.get(active) ?? active)
        : null;
      const related = projectedActive
        ? new Set([projectedActive, ...(adjacency.get(projectedActive) ?? [])])
        : null;
      const ring = (
        center: Point,
        r: number,
        color: string,
        dash: number[],
        alpha: number,
        strokeWidth = 0.8,
        start = 0,
        end = Math.PI * 2,
      ) => {
        const p = point(center),
          screenRadius = r * scale;
        // Do not tessellate huge dashed circles that cannot touch the viewport.
        const farthest = Math.max(
          Math.hypot(p.x, p.y),
          Math.hypot(p.x - width, p.y),
          Math.hypot(p.x, p.y - height),
          Math.hypot(p.x - width, p.y - height),
        );
        if (
          screenRadius > farthest + strokeWidth / 2 + 2 ||
          p.x + screenRadius < 0 ||
          p.y + screenRadius < 0 ||
          p.x - screenRadius > width ||
          p.y - screenRadius > height
        )
          return;
        ctx.strokeStyle = color;
        ctx.globalAlpha = clamp(alpha * opts.ink, 0, 1);
        ctx.lineWidth = strokeWidth;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * scale, start, end);
        ctx.stroke();
      };
      if (opts.ringStyle !== "none") {
        const style = opts.ringStyle;
        const dash =
          style === "dotted" ? [1, 7] : style === "dashed" ? [4, 10] : [];
        const opacity =
          style === "soft" ? 0.14 : style === "dotted" ? 0.26 : 0.2;
        for (const r of scene.orbits)
          ring({ x: 0, y: 0 }, r, "#999999", [3, 16], 0.22);
        for (const c of scene.components) {
          if (c.radius * scale > 28) {
            // Closely packed generations should read as guides, not a striped disk.
            for (let i = 0; i < c.rings.length; i++) {
              const r = c.rings[i];
              const separation = (r - (c.rings[i - 1] ?? 0)) * scale;
              const densityFade = clamp(separation / 10, 0.35, 1);
              if (
                style === "arcs" ||
                style === "ticks" ||
                bandStyles.has(style)
              ) {
                const tau = Math.PI * 2;
                const angles = (occupied.get(c.id)?.get(r) ?? []).map((id) => {
                  const p = positions.get(id)!;
                  return (
                    (Math.atan2(p.y - c.center.y, p.x - c.center.x) + tau) % tau
                  );
                });
                const half = Math.min(
                  0.24,
                  Math.max(0.025, (36 * scale + 8) / (r * scale)),
                );
                if (style === "ticks") {
                  const p = point(c.center),
                    radius = r * scale;
                  ctx.setLineDash([]);
                  ctx.lineWidth = 0.8;
                  ctx.strokeStyle = "#aaaaaa";
                  ctx.globalAlpha = clamp(0.3 * densityFade * opts.ink, 0, 1);
                  for (const angle of angles)
                    for (const a of [angle - half, angle + half]) {
                      const x = p.x + Math.cos(a) * radius,
                        y = p.y + Math.sin(a) * radius;
                      if (x < -8 || y < -8 || x > width + 8 || y > height + 8)
                        continue;
                      ctx.beginPath();
                      ctx.moveTo(x - Math.cos(a) * 2.5, y - Math.sin(a) * 2.5);
                      ctx.lineTo(x + Math.cos(a) * 2.5, y + Math.sin(a) * 2.5);
                      ctx.stroke();
                    }
                } else {
                  // Merge occupied intervals and split at the seam, leaving empty sectors open.
                  const intervals: number[][] = [];
                  for (const angle of angles) {
                    const a = angle - half,
                      b = angle + half;
                    if (a < 0) intervals.push([a + tau, tau], [0, b]);
                    else if (b > tau) intervals.push([a, tau], [0, b - tau]);
                    else intervals.push([a, b]);
                  }
                  intervals.sort((a, b) => a[0] - b[0]);
                  const merged: number[][] = [];
                  for (const interval of intervals) {
                    const last = merged.at(-1);
                    if (last && interval[0] <= last[1])
                      last[1] = Math.max(last[1], interval[1]);
                    else merged.push([...interval]);
                  }
                  for (const [a, b] of merged) {
                    const band =
                      Math.min(24, separation * 0.7) * opts.bandWidth;
                    if (style === "bands") {
                      ring(
                        c.center,
                        r,
                        "#bbbbbb",
                        [],
                        0.035 * densityFade,
                        band + 5,
                        a,
                        b,
                      );
                      ring(
                        c.center,
                        r,
                        "#bbbbbb",
                        [],
                        0.06 * densityFade,
                        band,
                        a,
                        b,
                      );
                    } else if (style === "mist") {
                      // Layered translucent strokes create feathered edges without canvas blur.
                      for (let layer = 5; layer >= 1; layer--)
                        ring(
                          c.center,
                          r,
                          "#cccccc",
                          [],
                          0.018 * densityFade,
                          band * (0.4 + layer * 0.35),
                          a,
                          b,
                        );
                    } else if (style === "ribbons") {
                      ring(
                        c.center,
                        r,
                        "#aaaaaa",
                        [],
                        0.045 * densityFade,
                        band,
                        a,
                        b,
                      );
                      const inset = band / (2 * scale);
                      ring(
                        c.center,
                        Math.max(0.1, r - inset),
                        "#aaaaaa",
                        [],
                        0.24 * densityFade,
                        0.65,
                        a,
                        b,
                      );
                      ring(
                        c.center,
                        r + inset,
                        "#aaaaaa",
                        [],
                        0.24 * densityFade,
                        0.65,
                        a,
                        b,
                      );
                    } else if (style === "terraces") {
                      // Alternate broad shelves and hairlines to distinguish neighboring generations.
                      const shelf =
                        Math.min(36, separation * 0.9) * opts.bandWidth;
                      const center = Math.max(0.1, r - shelf / (2 * scale));
                      ring(
                        c.center,
                        center,
                        "#bbbbbb",
                        [],
                        (i % 2 ? 0.035 : 0.085) * densityFade,
                        shelf,
                        a,
                        b,
                      );
                      ring(
                        c.center,
                        r,
                        "#bbbbbb",
                        [],
                        0.2 * densityFade,
                        0.7,
                        a,
                        b,
                      );
                    }
                    ring(
                      c.center,
                      r,
                      "#aaaaaa",
                      [],
                      (style === "arcs" ? 0.3 : style === "bands" ? 0.12 : 0) *
                        densityFade,
                      0.75,
                      a,
                      b,
                    );
                  }
                }
              } else {
                ring(
                  c.center,
                  r,
                  "#aaaaaa",
                  dash,
                  opacity * densityFade,
                  style === "soft" ? 0.65 : 0.8,
                );
              }
            }
            if (
              style === "arcs" ||
              style === "ticks" ||
              bandStyles.has(style)
            ) {
              // Four quiet brackets suggest the component boundary without enclosing it.
              for (let i = 0; i < 4; i++)
                ring(
                  c.center,
                  c.radius,
                  "#aaaaaa",
                  [],
                  0.24,
                  0.8,
                  (i * Math.PI) / 2 - 0.09,
                  (i * Math.PI) / 2 + 0.09,
                );
            } else ring(c.center, c.radius, "#aaaaaa", [], 0.3, 0.85);
          }
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const edge of scene.edges) {
        const a = positions.get(edge.source),
          b = positions.get(edge.target);
        if (!a || !b) continue;
        const p = point(a),
          q = point(b);
        const strong =
          projectedActive === edge.source || projectedActive === edge.target;
        ctx.strokeStyle = strong ? "#ddd" : "#777";
        ctx.lineWidth = strong ? 1.2 : 0.65;
        ctx.globalAlpha = related
          ? strong
            ? 0.9
            : 0.055
          : edge.relation === "citation"
            ? 0.14
            : 0.52;
        ctx.beginPath();
        if (edge.source === edge.target) {
          ctx.arc(
            p.x,
            p.y - 36 * scale,
            Math.max(5, 30 * scale),
            0.3,
            Math.PI * 2 - 0.3,
          );
        } else {
          // Live free-view edges are fine straight segments, trimmed to node bodies.
          const dx = q.x - p.x,
            dy = q.y - p.y,
            length = Math.hypot(dx, dy);
          if (length < 1) continue;
          const trim = Math.min(36 * scale, length * 0.4),
            ux = dx / length,
            uy = dy / length;
          ctx.moveTo(p.x + ux * trim, p.y + uy * trim);
          ctx.lineTo(q.x - ux * trim, q.y - uy * trim);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const labelBoxes: { x: number; y: number; w: number; h: number }[] = [];
      const text = (
        label: string,
        x: number,
        y: number,
        size: number,
        force = false,
      ) => {
        ctx.font = `${size}px Inter, system-ui, sans-serif`;
        const w = ctx.measureText(label).width + 8,
          h = size + 5;
        const box = { x: x - w / 2, y: y - h / 2, w, h };
        if (
          !force &&
          labelBoxes.some(
            (b) =>
              box.x < b.x + b.w &&
              box.x + box.w > b.x &&
              box.y < b.y + b.h &&
              box.y + box.h > b.y,
          )
        )
          return;
        labelBoxes.push(box);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#999";
        ctx.save();
        ctx.shadowColor = "#131313";
        ctx.shadowBlur = 4;
        ctx.fillText(label, x, y);
        ctx.restore();
      };
      let visible = 0;
      for (const node of scene.nodes) {
        const p = point(positions.get(node.id)!);
        if (p.x < -80 || p.y < -80 || p.x > width + 80 || p.y > height + 80)
          continue;
        visible++;
        const isActive = projectedActive === node.id,
          r = Math.max(1.3, 36 * scale);
        ctx.globalAlpha = related && !related.has(node.id) ? 0.22 : 1;
        const group = scene.groups.get(node.id);
        if (group) {
          const before = scene.edges.find(
            (e) => e.target === node.id && e.relation !== "citation",
          );
          const after = scene.edges.find(
            (e) => e.source === node.id && e.relation !== "citation",
          );
          const a = before ? positions.get(before.source) : null,
            b = after ? positions.get(after.target) : positions.get(node.id);
          const angle = a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
          const dot = Math.max(4.5, r / 1.82),
            step = dot * 0.82;
          for (let i = -1; i <= 1; i++) {
            circle(
              p.x + Math.cos(angle) * i * step,
              p.y + Math.sin(angle) * i * step,
              dot,
            );
            ctx.fillStyle = "#4a3346";
            ctx.strokeStyle = "#d3869b";
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
          }
          ctx.fillStyle = "#bbb";
          ctx.font = `700 ${clamp(dot * 1.3, 10, 22)}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText(
            "…",
            p.x + Math.cos(angle) * (2 * step + dot * 0.55),
            p.y + Math.sin(angle) * (2 * step + dot * 0.55),
          );
        } else {
          const isRoot = roots.has(node.id);
          circle(p.x, p.y, r);
          ctx.fillStyle = isRoot ? "#fff" : "#43566d";
          ctx.strokeStyle = isRoot ? "#f5f5f5" : "#9aa7b7";
          ctx.lineWidth = 1.4;
          ctx.fill();
          ctx.stroke();
          const tags = node.tags ?? [];
          if (tags.length && r > 3) {
            const halo =
              r +
              Math.max(2.5, Math.min(18, 3.5 / Math.max(0.2, scale)) * scale);
            tags.forEach((tag, i) => {
              ctx.beginPath();
              ctx.arc(
                p.x,
                p.y,
                halo,
                (i * 2 * Math.PI) / tags.length,
                ((i + 0.86) * 2 * Math.PI) / tags.length,
              );
              ctx.strokeStyle = tagColor(tag.id);
              ctx.lineWidth = 2;
              ctx.stroke();
            });
          }
        }
        if (isActive) {
          circle(p.x, p.y, r + 5);
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      {
        // Priority and collision checks keep overview labels separate from detail labels.
        for (const c of scene.components) {
          if (scale > 0.59) continue;
          const p = point(c.center);
          const radius = c.radius * scale;
          if (radius < 10) continue;
          text(
            c.title.length > 25 ? c.title.slice(0, 23) + "…" : c.title,
            p.x,
            p.y + radius + 18,
            clamp(radius * 0.12, 12, 18),
          );
        }
        const ordered = [...scene.nodes].sort(
          (a, b) =>
            Number(b.id === projectedActive) -
              Number(a.id === projectedActive) ||
            Number(roots.has(b.id)) - Number(roots.has(a.id)),
        );
        for (const n of ordered) {
          const focus = n.id === projectedActive;
          if (!focus && scale < 0.16) continue;
          const p = point(positions.get(n.id)!);
          if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
          const group = scene.groups.get(n.id);
          const title = group
            ? `${group.kind === "run" ? "Folded run" : "Leaf fan"} · ${group.members.length}`
            : n.title;
          text(
            title.length > 42 ? title.slice(0, 40) + "…" : title,
            p.x,
            p.y + Math.max(14, 36 * scale) + 17,
            focus ? 13 : 11,
            focus,
          );
        }
      }
      canvas.dataset.nodes = String(scene.nodes.length);
      canvas.dataset.originalNodes = String(nodes.length);
      canvas.dataset.visibleNodes = String(visible);
      canvas.dataset.groups = String(scene.groups.size);
      canvas.dataset.components = String(scene.components.length);
      canvas.dataset.zoom = String(scale);
      canvas.dataset.ringStyle = opts.ringStyle;
      canvas.dataset.ringInk = String(opts.ink);
      canvas.dataset.bandWidth = String(opts.bandWidth);
    }
    function invalidate() {
      if (!frame && !disposed) frame = requestAnimationFrame(draw);
    }
    redraw.current = invalidate;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hit = (p: Point) => {
      let found: string | null = null,
        best = Infinity;
      for (const n of scene.nodes) {
        const q = point(positions.get(n.id)!);
        const distance = Math.hypot(q.x - p.x, q.y - p.y);
        const radius = scene.groups.has(n.id)
          ? Math.max(12, 42 * camera.scale)
          : Math.max(7, 36 * camera.scale);
        if (distance < radius && distance < best) {
          found = n.id;
          best = distance;
        }
      }
      return found;
    };
    let drag: {
      point: Point;
      camera: Camera;
      node: string | null;
      start: Point;
      moved: boolean;
    } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = local(e);
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      drag = {
        point: p,
        start: p,
        camera: { ...camera },
        node: hit(p),
        moved: false,
      };
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (drag) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 4)
          drag.moved = true;
        if (drag.moved) {
          if (drag.node) {
            const q = positions.get(drag.node)!;
            q.x += (p.x - drag.point.x) / camera.scale;
            q.y += (p.y - drag.point.y) / camera.scale;
          } else {
            camera.x = drag.camera.x + p.x - drag.start.x;
            camera.y = drag.camera.y + p.y - drag.start.y;
          }
          drag.point = p;
          invalidate();
        }
        return;
      }
      const next = hit(p);
      if (next !== hover) {
        hover = next;
        canvas.style.cursor = next ? "pointer" : "grab";
        canvas.title = next
          ? scene.groups.has(next)
            ? `${byId.get(next)!.title}: ${scene.groups.get(next)!.members.length} nodes · Click to expand`
            : byId.get(next)!.title
          : "";
        invalidate();
      }
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      if (d.moved) return;
      if (d.node) {
        if (scene.groups.has(d.node)) {
          setExpanded((prev) => new Set([...prev, d.node!]));
        } else setSelected(d.node);
        return;
      }
      const p = local(e);
      const component = scene.components.find((c) => {
        const q = point(c.center);
        const distance = Math.hypot(q.x - p.x, q.y - p.y),
          r = c.radius * camera.scale;
        return Math.abs(distance - r) < 10 || (r < 90 && distance < r);
      });
      if (component) fit(component.center, component.radius);
      else setSelected(null);
    };
    const leave = () => {
      hover = null;
      invalidate();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(Math.exp(-clamp(e.deltaY, -100, 100) * 0.002), p.x, p.y);
    };
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === "f" || e.key === "0") {
        fit();
        e.preventDefault();
      } else if (e.key === "Escape") {
        setSelected(null);
      } else if (e.key.toLowerCase() === "r") {
        const next =
          ringStyles[
            (ringStyles.indexOf(options.current.ringStyle) + 1) %
              ringStyles.length
          ];
        const url = new URL(location.href);
        url.searchParams.set("ringStyle", next);
        history.replaceState(null, "", url.pathname + url.search + url.hash);
        setRingStyle(next);
      } else if (e.key === "c") {
        setExpanded(new Set());
      } else if (e.key === "+" || e.key === "=") zoomAt(1.25);
      else if (e.key === "-") zoomAt(0.8);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    const cancel = () => {
      drag = null;
    };
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [scene, nodes]);

  return (
    <section className="fw-study" aria-label="Flywheel graph">
      <canvas
        ref={canvasRef}
        className="fw-canvas"
        tabIndex={0}
        aria-label={`Interactive orbital graph. ${nodes.length} source nodes. Scroll to zoom, drag to pan or move nodes. F fits, C folds, R cycles ring styles, Escape clears selection.`}
      />
      <aside className="fw-ring-panel" aria-label="Ring style debug controls">
        <button
          className="fw-ring-heading"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <span>RING LAB</span>
          <span>{panelOpen ? "−" : "+"}</span>
        </button>
        {panelOpen && (
          <div className="fw-ring-settings">
            <select
              aria-label="Ring style"
              value={ringStyle}
              onChange={(e) => chooseStyle(e.target.value as RingStyle)}
            >
              {ringStyles.map((style) => (
                <option key={style} value={style}>
                  {styleNames[style]}
                </option>
              ))}
            </select>
            <label>
              Ink <output>{ink.toFixed(2)}×</output>
              <input
                aria-label="Ring ink"
                type="range"
                min="0.25"
                max="3"
                step="0.05"
                value={ink}
                disabled={ringStyle === "none"}
                onChange={(e) => changeLevel("ringInk", Number(e.target.value))}
              />
            </label>
            <label>
              Band width <output>{bandWidth.toFixed(1)}×</output>
              <input
                aria-label="Band width"
                type="range"
                min="0.4"
                max="2"
                step="0.1"
                value={bandWidth}
                disabled={!bandStyles.has(ringStyle)}
                onChange={(e) =>
                  changeLevel("bandWidth", Number(e.target.value))
                }
              />
            </label>
          </div>
        )}
      </aside>
    </section>
  );
}
