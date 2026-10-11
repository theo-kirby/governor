import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "../shared/types";
import type { Point } from "./flywheel-model";
import { layoutHub, NODE_RADIUS } from "./hub-model";
import "./flywheel.css";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
type Camera = Point & { scale: number };
type Props = { nodes: GraphNode[]; edges: GraphEdge[]; label?: string };

// Status reads at a glance; everything else stays grey so the colour means something.
const STATUS: Record<string, string> = {
  open: "#d8a657",
  broken: "#ea6962",
  blocked: "#c397d8",
  working: "#89b482",
  done: "#7d8590",
};
const statusOf = (n: GraphNode) =>
  n.tags?.find((t) => t.id.startsWith("status:"))?.id.slice(7) ??
  n.tags?.find((t) => t.name.startsWith("status:"))?.name.slice(7);

export function HubCanvas({ nodes, edges, label = "Graph" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const scene = useMemo(() => layoutHub(nodes, edges), [nodes, edges]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const redraw = useRef(() => {});
  useEffect(() => redraw.current(), [selected]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let width = 1,
      height = 1,
      frame = 0,
      disposed = false,
      hover: string | null = null;
    let camera: Camera = { x: 0, y: 0, scale: 1 };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const shown = nodes.filter((n) => scene.positions.has(n.id) && !scene.hidden.has(n.id));
    const times = shown
      .filter((n) => scene.kind.get(n.id) === "record")
      .map((n) => Date.parse(n.createdAt ?? "") || 0);
    const t0 = Math.min(...times),
      t1 = Math.max(...times);
    const age = (n: GraphNode) =>
      t1 > t0 ? (t1 - (Date.parse(n.createdAt ?? "") || t0)) / (t1 - t0) : 0;
    const neighbours = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      (neighbours.get(a) ?? neighbours.set(a, new Set()).get(a)!).add(b);
      (neighbours.get(b) ?? neighbours.set(b, new Set()).get(b)!).add(a);
    };
    const drawable = edges.filter(
      (e) =>
        scene.positions.has(e.source) &&
        scene.positions.has(e.target) &&
        !scene.hidden.has(e.source) &&
        !scene.hidden.has(e.target),
    );
    for (const e of drawable) link(e.source, e.target);
    // only the widest sectors get an overview label; the rest appear on zoom
    const bigSectors = [...scene.sectors]
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, 14);

    const point = (p: Point) => ({
      x: p.x * camera.scale + camera.x,
      y: p.y * camera.scale + camera.y,
    });
    const fit = () => {
      camera.scale = clamp(Math.min(width - 64, height - 64) / (2 * scene.extent), 1e-5, 2);
      camera.x = width / 2;
      camera.y = height / 2;
      invalidate();
    };
    const zoomAt = (factor: number, x = width / 2, y = height / 2) => {
      const next = clamp(camera.scale * factor, 1e-5, 8),
        ratio = next / camera.scale;
      camera = { x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio, scale: next };
      invalidate();
    };

    function draw() {
      frame = 0;
      if (disposed) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#131313";
      ctx.fillRect(0, 0, width, height);
      const s = camera.scale;
      const centre = point({ x: 0, y: 0 });
      const active = hover ?? selectedRef.current;
      const related = active ? new Set([active, ...(neighbours.get(active) ?? [])]) : null;

      // guides: dotted state rings, faint record rings, sector spokes
      ctx.lineWidth = 0.8;
      for (const ring of scene.rings) {
        ctx.setLineDash(ring.kind === "state" ? [1, 7] : [1, 12]);
        ctx.strokeStyle = "#aaaaaa";
        ctx.globalAlpha = ring.kind === "state" ? 0.28 : 0.1;
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, ring.radius * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([2, 10]);
      ctx.globalAlpha = 0.18;
      for (const sec of scene.sectors) {
        ctx.beginPath();
        ctx.moveTo(centre.x + Math.cos(sec.start) * 60 * s, centre.y + Math.sin(sec.start) * 60 * s);
        ctx.lineTo(
          centre.x + Math.cos(sec.start) * scene.extent * s,
          centre.y + Math.sin(sec.start) * scene.extent * s,
        );
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // edges: the state tree always; citations and record history only around the focus
      for (const e of drawable) {
        const ks = scene.kind.get(e.source),
          kt = scene.kind.get(e.target);
        const focus = related && (e.source === active || e.target === active);
        const tree = e.relation === "parent" && ks === "state" && kt === "state";
        if (!tree && !focus) continue;
        const a = point(scene.positions.get(e.source)!),
          b = point(scene.positions.get(e.target)!);
        ctx.strokeStyle = e.relation === "citation" ? "#d8a657" : "#bbbbbb";
        ctx.globalAlpha = focus ? 0.85 : related ? 0.08 : 0.45;
        ctx.lineWidth = focus ? 1.2 : 0.7;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // nodes
      const r0 = Math.max(1.2, NODE_RADIUS * s);
      for (const n of shown) {
        const p = point(scene.positions.get(n.id)!);
        if (p.x < -40 || p.y < -40 || p.x > width + 40 || p.y > height + 40) continue;
        const k = scene.kind.get(n.id);
        const isHub = n.id === scene.hub;
        const st = statusOf(n);
        ctx.globalAlpha = related && !related.has(n.id) ? 0.18 : 1;
        ctx.beginPath();
        const r = isHub ? r0 * 1.6 : k === "state" ? r0 * 1.15 : r0 * 0.75;
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        if (isHub) {
          ctx.fillStyle = "#ffffff";
        } else if (k === "state") {
          ctx.fillStyle = (st && STATUS[st]) || "#9aa7b7";
        } else {
          const l = Math.round(62 - 34 * age(n)); // older records fade outward
          ctx.fillStyle = `hsl(212 14% ${l}%)`;
        }
        ctx.fill();
        if (n.id === active) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // labels: sectors at overview, state titles when zoomed, the focus always
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const text = (t: string, x: number, y: number, size: number, color = "#9a9a9a") => {
        ctx.font = `${size}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.save();
        ctx.shadowColor = "#131313";
        ctx.shadowBlur = 4;
        ctx.fillText(t.length > 44 ? t.slice(0, 42) + "…" : t, x, y);
        ctx.restore();
      };
      if (s < 0.5)
        for (const sec of bigSectors) {
          const mid = (sec.start + sec.end) / 2,
            rr = (scene.bandStart - 120) * s;
          text(sec.title, centre.x + Math.cos(mid) * rr, centre.y + Math.sin(mid) * rr, 12, "#c8c8c8");
        }
      if (s >= 0.5)
        for (const n of shown) {
          if (scene.kind.get(n.id) !== "state" || n.id === active) continue;
          const p = point(scene.positions.get(n.id)!);
          if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
          text(n.title, p.x, p.y + NODE_RADIUS * s * 1.15 + 12, 11);
        }
      if (active && byId.has(active)) {
        const n = byId.get(active)!;
        const p = point(scene.positions.get(active)!);
        const when = n.createdAt ? ` · ${n.createdAt.slice(0, 10)}` : "";
        text(`${n.title}${when}`, p.x, p.y - NODE_RADIUS * s - 16, 13, "#f0f0f0");
      }
      canvas.dataset.nodes = String(shown.length);
      canvas.dataset.sectors = String(scene.sectors.length);
      canvas.dataset.zoom = String(s);
    }
    function invalidate() {
      if (!frame && !disposed) frame = requestAnimationFrame(draw);
    }
    redraw.current = invalidate;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (width === rect.width && height === rect.height) return;
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
      for (const n of shown) {
        const q = point(scene.positions.get(n.id)!);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < Math.max(6, NODE_RADIUS * camera.scale) && d < best) {
          found = n.id;
          best = d;
        }
      }
      return found;
    };
    let drag: { start: Point; camera: Camera; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { start: local(e), camera: { ...camera }, moved: false };
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (drag) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 4) drag.moved = true;
        if (drag.moved) {
          camera.x = drag.camera.x + p.x - drag.start.x;
          camera.y = drag.camera.y + p.y - drag.start.y;
          invalidate();
        }
        return;
      }
      const next = hit(p);
      if (next !== hover) {
        hover = next;
        canvas.style.cursor = next ? "pointer" : "grab";
        invalidate();
      }
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!d.moved) setSelected(hit(local(e)));
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
      if (e.key === "f" || e.key === "0") fit();
      else if (e.key === "Escape") setSelected(null);
      else if (e.key === "+" || e.key === "=") zoomAt(1.25);
      else if (e.key === "-") zoomAt(0.8);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
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
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [scene, nodes, edges]);

  return (
    <section className="fw-study" aria-label="Hub graph">
      <canvas
        ref={canvasRef}
        className="fw-canvas"
        tabIndex={0}
        aria-label={`${label}. Hub layout: state at the centre, records on the rim. ${nodes.length} source nodes. Scroll to zoom, drag to pan. F fits, Escape clears selection.`}
      />
    </section>
  );
}
