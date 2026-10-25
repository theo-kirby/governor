import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "../shared/types";
import {
  layoutFlywheel,
  layoutFocus,
  projectFlywheel,
  type Point,
} from "./flywheel-model";
import { NodePanel, type LoadNode } from "./NodePanel";
import "./flywheel.css";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const tagColor = (id: string) => {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 60% 58%)`;
};
type Camera = Point & { scale: number };
type Panel = { side: "left" | "right"; open: boolean; id: string };
// The detail panel covers half a wide screen, or the lower part of a narrow one.
const WIDE = 800;
// The focus fan opens slightly less than a half circle, away from the panel.
const SPREAD = Math.PI * 0.92;
type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label?: string;
  onLayout?: (ms: number) => void;
  /** Reads a node's body; when given, clicking a node opens the detail panel. */
  details?: LoadNode;
};

export function FlywheelCanvas({
  nodes,
  edges,
  label = "Graph",
  onLayout,
  details,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousView = useRef<{
    layoutKey: string;
    camera: Camera;
    positions: Map<string, Point>;
    width: number;
    height: number;
    fanned: boolean;
    owner: Map<string, string>;
  } | null>(null);
  const [expanded, setExpanded] = useState(new Set<string>());
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
  const [panel, setPanel] = useState<Panel | null>(null);
  const panelOpen = panel?.open ? panel.side : null;
  const options = useRef({ selected, panelOpen });
  options.current = { selected, panelOpen };
  const redraw = useRef(() => {});
  const focus = useRef((_id: string) => {});
  const unfocus = useRef(() => {});
  const enabled = useRef(details);
  enabled.current = details;
  useEffect(() => redraw.current(), [selected]);
  const select = useCallback((id: string) => {
    setSelected(id);
    setPanel((p) => (p?.open ? { ...p, id } : p));
  }, []);
  const close = useCallback(() => {
    setSelected(null);
    setPanel((p) => p && { ...p, open: false });
  }, []);

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
    const layoutKey = JSON.stringify([...scene.positions]);
    const savedView = previousView.current;
    const restoreView = savedView?.layoutKey === layoutKey ? savedView : null;
    if (restoreView)
      for (const [id, p] of restoreView.positions) positions.set(id, { ...p });
    // the orbital layout to return to when the panel closes
    const base = new Map([...positions].map(([id, p]) => [id, { ...p }]));
    // A fold opened while the fan is showing: start every node where it (or the
    // fold that held it) was, so the fan rearranges instead of jumping.
    const carry = savedView?.fanned && !restoreView ? savedView : null;
    if (carry)
      for (const id of positions.keys()) {
        const p =
          carry.positions.get(id) ??
          carry.positions.get(carry.owner.get(id) ?? "");
        if (p) positions.set(id, { ...p });
      }
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
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
    // The part of the canvas the detail panel leaves visible.
    const free = () => {
      const side = options.current.panelOpen;
      if (!side) return { x: 0, y: 0, w: width, h: height };
      if (width < WIDE) return { x: 0, y: 0, w: width, h: height * 0.4 };
      return { x: side === "left" ? width / 2 : 0, y: 0, w: width / 2, h: height };
    };
    let animation = 0;
    // 0 = orbital layout, 1 = focus fan; ring guides cross-fade between them
    let blend = carry ? 1 : 0;
    let fan: { id: string; direction: number; rings: number[] } | null = null;
    // Tween the camera, and optionally every node, to a target over one easing.
    const moveTo = (
      target: Camera,
      to?: Map<string, Point>,
      toBlend = blend,
    ) => {
      cancelAnimationFrame(animation);
      const from = { ...camera },
        fromBlend = blend,
        start = performance.now();
      const starts = to
        ? new Map([...to.keys()].map((id) => [id, { ...positions.get(id)! }]))
        : null;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / (to ? 700 : 450)),
          ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
        camera = {
          x: from.x + (target.x - from.x) * ease,
          y: from.y + (target.y - from.y) * ease,
          // zoom geometrically so the motion feels even
          scale: from.scale * (target.scale / from.scale) ** ease,
        };
        if (to && starts)
          for (const [id, a] of starts) {
            const b = to.get(id)!,
              p = positions.get(id);
            if (!p) continue;
            p.x = a.x + (b.x - a.x) * ease;
            p.y = a.y + (b.y - a.y) * ease;
          }
        blend = fromBlend + (toBlend - fromBlend) * ease;
        invalidate();
        animation = t < 1 ? requestAnimationFrame(step) : 0;
      };
      animation = requestAnimationFrame(step);
    };
    const framing = (center: Point, radius: number, max = 1.5) => {
      const area = free();
      const scale = clamp(
        Math.min(area.w - 96, area.h - 96) / (2 * radius),
        0.00001,
        max,
      );
      return {
        x: area.x + area.w / 2 - center.x * scale,
        y: area.y + area.h / 2 - center.y * scale,
        scale,
      };
    };
    // The fan's origin sits by the panel; `radius` (world units) must fit the free area.
    const fanCamera = (direction: number, radius: number): Camera => {
      const narrow = Math.abs(Math.sin(direction)) > 0.5;
      // room for the focus node's label between it and the panel
      const area = free(),
        inset = narrow ? 70 : 150;
      const origin = narrow
        ? { x: area.x + area.w / 2, y: area.y + area.h - inset }
        : {
            x: Math.cos(direction) > 0 ? area.x + inset : area.x + area.w - inset,
            y: area.y + area.h / 2,
          };
      const along = (narrow ? area.h - inset : area.w - inset) - 50,
        across = (narrow ? area.w : area.h) / 2 - 36;
      const scale = clamp(
        Math.min(along / (radius + 70), across / (radius + 30)),
        0.00001,
        1.2,
      );
      return { x: origin.x, y: origin.y, scale };
    };
    const fit = (center: Point = { x: 0, y: 0 }, radius = scene.extent) => {
      cancelAnimationFrame(animation);
      if (fan) {
        moveTo(fanCamera(fan.direction, fan.rings.at(-1) ?? 140));
        return;
      }
      camera = framing(center, radius);
      invalidate();
    };
    // Rearrange the graph as a fan rooted at the node, opening away from the panel.
    focus.current = (id: string) => {
      const owned = scene.owner.get(id) ?? id;
      const side = options.current.panelOpen;
      if (!side || !positions.has(owned)) return;
      const direction =
        width < WIDE ? -Math.PI / 2 : side === "left" ? 0 : Math.PI;
      const layout = layoutFocus(
        scene.nodes,
        scene.edges,
        owned,
        direction,
        SPREAD,
      );
      fan = { id: owned, direction, rings: layout.rings };
      // frame the first rings, enough of them to show a dozen nodes (at most four)
      let ring = 0;
      for (
        let seen = layout.counts[0] ?? 0;
        ring < Math.min(3, layout.rings.length - 1) && seen < 12;
        seen += layout.counts[++ring]
      );
      moveTo(
        fanCamera(direction, layout.rings[ring] ?? 140),
        layout.positions,
        1,
      );
    };
    unfocus.current = () => {
      if (!fan && !carry) return;
      fan = null;
      const area = { w: width, h: height };
      const scale = clamp(
        Math.min(area.w - 96, area.h - 96) / (2 * scene.extent),
        0.00001,
        1.5,
      );
      moveTo(
        { x: width / 2, y: height / 2, scale },
        base,
        0,
      );
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
      // Nothing draws under the detail panel.
      ctx.save();
      if (opts.panelOpen) {
        const area = free();
        ctx.beginPath();
        ctx.rect(area.x, area.y, area.w, area.h);
        ctx.clip();
      }
      // A selection keeps its neighbourhood lit; hover only previews when nothing is selected.
      const active = opts.selected ?? hover;
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
        ctx.globalAlpha = alpha;
        ctx.lineWidth = strokeWidth;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * scale, start, end);
        ctx.stroke();
      };
      const orbital = 1 - blend;
      for (const r of fan || blend > 0.999 ? [] : scene.orbits)
        ring({ x: 0, y: 0 }, r, "#999999", [3, 16], 0.22 * orbital);
      if (fan && blend > 0.001)
        for (const r of fan.rings)
          ring(
            { x: 0, y: 0 },
            r,
            "#aaaaaa",
            [1, 7],
            0.3 * blend,
            0.8,
            fan.direction - SPREAD / 2 - 0.05,
            fan.direction + SPREAD / 2 + 0.05,
          );
      for (const c of orbital > 0.001 ? scene.components : []) {
        if (c.radius * scale <= 28) continue;
        for (let i = 0; i < c.rings.length; i++) {
          const r = c.rings[i];
          const separation = (r - (c.rings[i - 1] ?? 0)) * scale;
          const densityFade = clamp(separation / 10, 0.35, 1);
          ring(c.center, r, "#aaaaaa", [1, 7], 0.26 * densityFade * orbital, 0.8);
        }
        ring(c.center, c.radius, "#aaaaaa", [], 0.3 * orbital, 0.85);
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
        color = "#999",
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
        ctx.fillStyle = color;
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
        ctx.globalAlpha =
          related && !related.has(node.id) ? (opts.selected ? 0.12 : 0.22) : 1;
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
        if (isActive || (hover === node.id && opts.selected)) {
          circle(p.x, p.y, r + 5);
          ctx.strokeStyle = isActive ? "#fff" : "#888";
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      {
        // Priority and collision checks keep overview labels separate from detail labels.
        for (const c of blend < 0.5 ? scene.components : []) {
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
            // a selection's neighbours claim label space before everything else
            Number(!!opts.selected && !!related?.has(b.id)) -
              Number(!!opts.selected && !!related?.has(a.id)) ||
            Number(roots.has(b.id)) - Number(roots.has(a.id)),
        );
        for (const n of ordered) {
          const focus = n.id === projectedActive;
          if (!focus && scale < 0.16 && !(opts.selected && related?.has(n.id)))
            continue;
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
            opts.selected && related?.has(n.id) ? "#e6e6e6" : "#999",
          );
        }
      }
      ctx.restore();
      canvas.dataset.fanned = String(!!fan);
      canvas.dataset.nodes = String(scene.nodes.length);
      canvas.dataset.originalNodes = String(nodes.length);
      canvas.dataset.visibleNodes = String(visible);
      canvas.dataset.groups = String(scene.groups.size);
      canvas.dataset.components = String(scene.components.length);
      canvas.dataset.zoom = String(scale);
      canvas.dataset.ringStyle = "dotted";
    }
    function invalidate() {
      if (!frame && !disposed) frame = requestAnimationFrame(draw);
    }
    redraw.current = invalidate;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (width === rect.width && height === rect.height) return;
      const initialResize = width === 1 && height === 1;
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const kept = restoreView ?? carry;
      if (
        initialResize &&
        kept &&
        kept.width === width &&
        kept.height === height
      ) {
        camera = { ...kept.camera };
        invalidate();
      } else if (fan) {
        camera = fanCamera(fan.direction, fan.rings[0] ?? 140);
        invalidate();
      } else fit();
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
      cancelAnimationFrame(animation);
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
        } else {
          const id = d.node;
          setSelected(id);
          if (enabled.current)
            setPanel((prev) =>
              prev?.open
                ? { ...prev, id }
                : { side: d.start.x < width / 2 ? "left" : "right", open: true, id },
            );
        }
        return;
      }
      const p = local(e);
      const component = fan ? null : scene.components.find((c) => {
        const q = point(c.center);
        const distance = Math.hypot(q.x - p.x, q.y - p.y),
          r = c.radius * camera.scale;
        return Math.abs(distance - r) < 10 || (r < 90 && distance < r);
      });
      if (component) fit(component.center, component.radius);
      else {
        setSelected(null);
        setPanel((p) => p && { ...p, open: false });
      }
    };
    const leave = () => {
      hover = null;
      invalidate();
    };
    // Shift + wheel zooms; a plain wheel scrolls the page (see HubCanvas)
    const wheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      cancelAnimationFrame(animation);
      const p = local(e);
      zoomAt(Math.exp(-clamp(e.deltaY || e.deltaX, -100, 100) * 0.002), p.x, p.y);
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
        setPanel((p) => p && { ...p, open: false });
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
      previousView.current = {
        layoutKey,
        camera,
        positions,
        width,
        height,
        fanned: !!fan,
        owner: scene.owner,
      };
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(animation);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [scene, nodes]);
  // A node picked from the panel may sit inside a fold: open folds until it shows.
  useEffect(() => {
    const owner = selected && scene.owner.get(selected);
    if (owner && owner !== selected && scene.groups.has(owner))
      setExpanded((prev) => new Set([...prev, owner]));
  }, [selected, scene]);
  useEffect(() => {
    if (selected && panelOpen) focus.current(selected);
  }, [selected, panelOpen, scene]);
  useEffect(() => {
    if (!panelOpen) unfocus.current();
  }, [panelOpen]);

  return (
    <section className="fw-study" aria-label="Flywheel graph">
      <canvas
        ref={canvasRef}
        className="fw-canvas"
        tabIndex={0}
        data-tagged-nodes={nodes.filter((node) => node.tags?.length).length}
        aria-label={`${label}. Interactive orbital graph. ${nodes.length} source nodes. Shift + scroll to zoom, drag to pan or move nodes. F fits, C folds, Escape clears selection.`}
      />
      {panel && details && (
        <NodePanel
          id={panel.id}
          side={panel.side}
          open={panel.open}
          nodes={nodes}
          edges={edges}
          load={details}
          onSelect={select}
          onClose={close}
          onClosed={() => setPanel((p) => (p?.open ? p : null))}
        />
      )}
    </section>
  );
}
