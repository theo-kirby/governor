import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "../shared/types";
import type { Point } from "./flywheel-model";
import { layoutHub, NODE_RADIUS, statusOf } from "./hub-model";
import { NodePanel, type LoadNode } from "./NodePanel";
import "./flywheel.css";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** How far an edge bows past a circular arc tangent to its spoke (hypergraph-viz settled on ~1.75–2.1). */
const BOW = 1.75;
type Camera = Point & { scale: number };
// The detail panel covers the right half of a wide canvas, or the lower part of a narrow one.
const WIDE = 800;
/** The share of a wide canvas the panel takes (report.css sets its width to match). */
const PANEL = 0.56;
export type HubTheme = "dark" | "light";
type Status = "open" | "broken" | "blocked" | "working" | "done";
/** Colours an embedding page may set over a palette: records run newest to oldest. */
export type HubColours = {
  citation?: string;
  status?: Partial<Record<Status, string>>;
  tint?: Partial<Record<Status | "record", string>>;
  records?: string[];
};
type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label?: string;
  theme?: HubTheme;
  colours?: HubColours;
  /** Name every node that has room for it, rather than only the one in focus. */
  names?: boolean;
  /** Reads a node's body; when given, clicking a node opens the detail panel and the graph moves aside. */
  details?: LoadNode;
  /** Distort the wheel a little, bring the records in, and draw every citation faintly. */
  organic?: boolean;
};

// Status reads at a glance; everything else stays quiet so the colour means something.
// Both palettes are the Ouroboros run page's tokens (ok, warn, bad, acc and their -bg
// tints), so the graph sits in that page as part of it. Records take the accent, newest
// darkest; a blob is its colour's tint with a thin rim of the colour itself.
const PALETTES = {
  dark: {
    bg: "#17181a", guide: "#6a6964", tree: "#8a877f", citation: "#8fb4dc", hub: "#e7e4dc", state: "#9b978e",
    ring: "#e7e4dc", label: "#9b978e", focus: "#e7e4dc",
    record: (age: number) => `hsl(211 52% ${Math.round(72 - 30 * age)}%)`, // older records fade into the paper
    status: { open: "#e0b25e", broken: "#e8867c", blocked: "#c3a0e0", working: "#7cc495", done: "#9b978e" },
    tint: { open: "#2f2615", broken: "#33201d", blocked: "#2a2333", working: "#1b2a20", done: "#26272a", record: "#1e2a36" },
  },
  light: {
    bg: "#fbfaf6", guide: "#8a857a", tree: "#a9a497", citation: "#1f4e79", hub: "#1d1d1b", state: "#8a96a6",
    ring: "#1d1d1b", label: "#6d6a63", focus: "#1d1d1b",
    record: (age: number) => `hsl(209 52% ${Math.round(30 + 42 * age)}%)`,
    status: { open: "#a46a10", broken: "#a4332b", blocked: "#7a4f9e", working: "#2f7a4d", done: "#7d8590" },
    tint: { open: "#f6ecd9", broken: "#f5e1de", blocked: "#eee5f5", working: "#e4f0e7", done: "#ece8dd", record: "#e3ebf3" },
  },
} as const;

export function HubCanvas({ nodes, edges, label = "Graph", theme = "dark", colours, names = false, details, organic = false }: Props) {
  const P = useMemo(() => {
    const base = PALETTES[theme], rs = colours?.records;
    return {
      ...base,
      citation: colours?.citation ?? base.citation,
      status: { ...base.status, ...colours?.status },
      tint: { ...base.tint, ...colours?.tint },
      record: rs?.length ? (age: number) => rs[Math.round(age * (rs.length - 1))] : base.record,
    };
  }, [theme, colours]);
  const STATUS: Record<string, string> = P.status;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const scene = useMemo(() => layoutHub(nodes, edges, { organic }), [nodes, edges, organic]);
  const [panel, setPanel] = useState<{ open: boolean; id: string } | null>(null);
  const panelOpen = !!panel?.open;
  const panelRef = useRef(panelOpen);
  panelRef.current = panelOpen;
  const detailsRef = useRef(details);
  detailsRef.current = details;
  const refit = useRef(() => {});
  useEffect(() => refit.current(), [panelOpen]);
  const pick = (id: string | null) => {
    setSelected(id);
    if (id && detailsRef.current) setPanel({ open: true, id });
    else setPanel((p) => p && { ...p, open: false });
  };
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const namesRef = useRef(names);
  namesRef.current = names;
  const redraw = useRef(() => {});
  useEffect(() => redraw.current(), [selected, names]);

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
    const blobs = scene.groups.map((g) => {
      const path = new Path2D();
      for (const loop of g.loops) {
        path.moveTo(loop[0].x, loop[0].y);
        for (const p of loop.slice(1)) path.lineTo(p.x, p.y);
        path.closePath();
      }
      return [g, path] as const;
    });

    const point = (p: Point) => ({
      x: p.x * camera.scale + camera.x,
      y: p.y * camera.scale + camera.y,
    });
    // The part of the canvas the detail panel leaves visible.
    const free = () =>
      !panelRef.current ? { x: 0, y: 0, w: width, h: height }
        : width < WIDE ? { x: 0, y: 0, w: width, h: height * 0.4 }
          : { x: 0, y: 0, w: width * (1 - PANEL), h: height };
    const fitted = (): Camera => {
      const f = free();
      return {
        scale: clamp(Math.min(f.w - 32, f.h - 32) / (2 * scene.extent), 1e-5, 2),
        x: f.x + f.w / 2,
        y: f.y + f.h / 2,
      };
    };
    let glide = 0;
    const fit = () => {
      cancelAnimationFrame(glide);
      camera = fitted();
      invalidate();
    };
    // Eases the camera to the fitted view, as the panel opens or closes.
    const glideToFit = () => {
      cancelAnimationFrame(glide);
      const from = { ...camera }, to = fitted(), t0 = performance.now();
      const ms = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 360;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms), e = 1 - (1 - t) ** 3;
        camera = {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          scale: from.scale * (to.scale / from.scale) ** e,
        };
        invalidate();
        if (t < 1) glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    };
    refit.current = glideToFit;
    const zoomAt = (factor: number, x = width / 2, y = height / 2) => {
      cancelAnimationFrame(glide);
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
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, 0, width, height);
      const s = camera.scale;
      const centre = point({ x: 0, y: 0 });
      const active = hover ?? selectedRef.current;
      const related = active ? new Set([active, ...(neighbours.get(active) ?? [])]) : null;

      // guides: dotted state rings, faint record rings, sector spokes
      ctx.lineWidth = 0.8;
      for (const ring of scene.rings) {
        ctx.setLineDash(ring.kind === "state" ? [1, 7] : [1, 12]);
        ctx.strokeStyle = P.guide;
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

      // groups: a blob round each status's claims and round the records, joining near neighbours
      ctx.save();
      ctx.translate(camera.x, camera.y);
      ctx.scale(s, s);
      ctx.lineWidth = 1 / s;
      for (const [g, path] of blobs) {
        const key = g.kind === "record" ? "record" : (g.status ?? "");
        const rim = g.kind === "record" ? P.record(0.35) : (STATUS[key] ?? P.state);
        ctx.fillStyle = (P.tint as Record<string, string>)[key] ?? P.tint.done;
        ctx.globalAlpha = related ? 0.45 : 1;
        ctx.fill(path, "evenodd");
        ctx.strokeStyle = rim;
        ctx.globalAlpha = related ? 0.12 : 0.4;
        ctx.stroke(path);
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // An edge bows: it leaves its inner end along that node's spoke (the line from the hub)
      // and curves into the other, so a parent's children fan out of one line.
      // hypergraph-viz's bowPoints: the sag of a circular arc tangent to the spoke, times BOW.
      const bow = (from: string, to: string, a: Point, b: Point) => {
        const pa = scene.positions.get(from)!,
          pb = scene.positions.get(to)!;
        if (Math.hypot(pb.x, pb.y) < Math.hypot(pa.x, pa.y)) [a, b] = [b, a];
        const inner = Math.hypot(pa.x, pa.y) <= Math.hypot(pb.x, pb.y) ? pa : pb;
        const ri = Math.hypot(inner.x, inner.y);
        const dx = b.x - a.x,
          dy = b.y - a.y,
          len = Math.hypot(dx, dy);
        ctx.moveTo(a.x, a.y);
        if (ri < 1 || len < 1) return void ctx.lineTo(b.x, b.y); // the hub has no spoke
        const nx = inner.x / ri,
          ny = inner.y / ri;
        // past 45° off the spoke the arc would loop out; a far child gets the 45° bow
        const alpha = clamp(Math.atan2(nx * dy - ny * dx, nx * dx + ny * dy), -Math.PI / 4, Math.PI / 4);
        const sag = (-len / 2) * Math.tan(alpha / 2) * BOW;
        const mx = (a.x + b.x) / 2 - (dy / len) * sag,
          my = (a.y + b.y) / 2 + (dx / len) * sag;
        ctx.quadraticCurveTo(2 * mx - (a.x + b.x) / 2, 2 * my - (a.y + b.y) / 2, b.x, b.y);
      };

      // edges: the state tree always; citations and record history only around the focus, or
      // every citation faintly when organic (a claim and its record cite each other: drawn once)
      const drawn = new Set<string>();
      for (const e of drawable) {
        const ks = scene.kind.get(e.source),
          kt = scene.kind.get(e.target);
        const focus = related && (e.source === active || e.target === active);
        const tree = e.relation === "parent" && ks === "state" && kt === "state";
        const cited = organic && e.relation === "citation" && ks !== kt;
        if (!tree && !focus && !cited) continue;
        const pair = e.source < e.target ? `${e.source} ${e.target}` : `${e.target} ${e.source}`;
        if (!focus && cited && drawn.has(pair)) continue;
        drawn.add(pair);
        const a = point(scene.positions.get(e.source)!),
          b = point(scene.positions.get(e.target)!);
        ctx.strokeStyle = e.relation === "citation" ? P.citation : P.tree;
        ctx.globalAlpha = focus ? 0.85 : related ? 0.06 : tree ? 0.45 : 0.16;
        ctx.lineWidth = focus ? 1.8 : tree ? 1.2 : 0.9;
        ctx.beginPath();
        bow(e.source, e.target, a, b);
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
          ctx.fillStyle = P.hub;
        } else if (k === "state") {
          ctx.fillStyle = (st && STATUS[st]) || P.state;
        } else {
          ctx.fillStyle = P.record(age(n));
        }
        ctx.fill();
        ctx.strokeStyle = P.bg; // a hairline of paper keeps packed nodes apart
        ctx.lineWidth = Math.max(0.5, Math.min(2, 2.5 * s));
        ctx.stroke();
        if (n.id === active) {
          ctx.strokeStyle = P.ring;
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
      const text = (t: string, x: number, y: number, size: number, color: string = P.label) => {
        ctx.font = `${size}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.save();
        ctx.shadowColor = P.bg;
        ctx.shadowBlur = 4;
        ctx.fillText(t.length > 44 ? t.slice(0, 42) + "…" : t, x, y);
        ctx.restore();
      };
      // names when asked for, small, under each node; one that would overlap a name already drawn
      // is left out, so zooming in names more. Otherwise the overview is the shape, the hover names a node.
      if (namesRef.current) {
        const taken: { x: number; y: number; w: number; h: number }[] = [];
        for (const n of shown) {
          if (n.id === scene.hub || n.id === active) continue;
          const p = point(scene.positions.get(n.id)!);
          if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
          const t = n.title.length > 44 ? n.title.slice(0, 42) + "…" : n.title;
          ctx.font = "10px Inter, system-ui, sans-serif";
          const w = ctx.measureText(t).width + 6;
          const y = p.y + NODE_RADIUS * s * (scene.kind.get(n.id) === "state" ? 1.15 : 0.75) + 10;
          const box = { x: p.x - w / 2, y: y - 7, w, h: 14 };
          if (taken.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y)) continue;
          taken.push(box);
          text(n.title, p.x, y, 10);
        }
      }
      if (active && byId.has(active)) {
        const n = byId.get(active)!;
        const p = point(scene.positions.get(active)!);
        const when = n.createdAt ? ` · ${n.createdAt.slice(0, 10)}` : "";
        text(`${n.title}${when}`, p.x, p.y - NODE_RADIUS * s - 16, 13, P.focus);
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
          cancelAnimationFrame(glide);
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
      if (!d.moved) pick(hit(local(e)));
    };
    const leave = () => {
      hover = null;
      invalidate();
    };
    // Shift + wheel zooms; a plain wheel scrolls the page the graph sits in. Some systems turn a
    // shifted wheel sideways, so the delta is whichever axis moved.
    const wheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      const p = local(e);
      zoomAt(Math.exp(-clamp(e.deltaY || e.deltaX, -100, 100) * 0.002), p.x, p.y);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "0") fit();
      else if (e.key === "Escape") pick(null);
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
      cancelAnimationFrame(glide);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [scene, nodes, edges, P, organic]);

  return (
    <section className="fw-study" aria-label="Hub graph">
      <canvas
        ref={canvasRef}
        className="fw-canvas"
        tabIndex={0}
        aria-label={`${label}. Hub layout: state at the centre, records on the rim. ${nodes.length} source nodes. Shift + scroll to zoom, drag to pan. F fits, N names the nodes, Escape clears selection.`}
      />
      {panel && details && (
        <NodePanel
          id={panel.id}
          side="right"
          open={panel.open}
          nodes={nodes}
          edges={edges}
          load={details}
          onSelect={pick}
          onClose={() => pick(null)}
          onClosed={() => setPanel((p) => (p?.open ? p : null))}
        />
      )}
    </section>
  );
}
