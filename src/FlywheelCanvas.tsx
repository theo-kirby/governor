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
  const [fold, setFold] = useState(true),
    [guides, setGuides] = useState(true),
    [citations, setCitations] = useState(true),
    [labels, setLabels] = useState(true);
  const [panel, setPanel] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(100);
  const commands = useRef({
    fit: () => {},
    focus: (_id: string) => {},
    zoom: (_factor: number) => {},
  });
  const scene = useMemo(() => {
    const start = performance.now();
    const projected = projectFlywheel(nodes, edges, expanded, fold);
    return {
      ...projected,
      ...layoutFlywheel(projected.nodes, projected.edges),
      milliseconds: performance.now() - start,
    };
  }, [nodes, edges, expanded, fold]);
  useEffect(() => onLayout?.(scene.milliseconds), [scene, onLayout]);
  const selection = nodes.find((n) => n.id === selected);
  const results = search.trim()
    ? nodes
        .filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 12)
    : [];
  const options = useRef({ guides, citations, labels, selected, search });
  options.current = { guides, citations, labels, selected, search };
  const redraw = useRef(() => {});
  useEffect(
    () => redraw.current(),
    [guides, citations, labels, selected, search],
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let width = 1,
      height = 1,
      frame = 0,
      disposed = false,
      hover: string | null = null;
    let camera: Camera = { x: 0, y: 0, scale: 1 },
      baseScale = 1;
    const positions = new Map(
      [...scene.positions].map(([id, p]) => [id, { ...p }]),
    );
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
    const fit = (center: Point = { x: 0, y: 0 }, radius = scene.extent) => {
      camera.scale = clamp(
        Math.min(width - 120, height - 180) / (2 * radius),
        0.00001,
        1.5,
      );
      camera.x = width / 2 - center.x * camera.scale;
      camera.y = (height + 30) / 2 - center.y * camera.scale;
      if (radius === scene.extent) baseScale = camera.scale;
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
          screenRadius > farthest + 2 ||
          p.x + screenRadius < 0 ||
          p.y + screenRadius < 0 ||
          p.x - screenRadius > width ||
          p.y - screenRadius > height
        )
          return;
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.05;
        ctx.setLineDash(dash);
        circle(p.x, p.y, r * scale);
        ctx.stroke();
      };
      if (opts.guides) {
        for (const r of scene.orbits)
          ring({ x: 0, y: 0 }, r, "#707070", [8, 10], 0.55);
        for (const c of scene.components) {
          if (c.radius * scale > 28) {
            for (const r of c.rings) ring(c.center, r, "#7db5a5", [5, 3], 0.35);
            ring(
              c.center,
              c.radius,
              c.roots.length > 1 ? "#5b8def" : "#d2ab2f",
              [10, 4, 2, 4],
              0.6,
            );
          }
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const edge of scene.edges) {
        if (edge.relation === "citation" && !opts.citations) continue;
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
      if (opts.labels) {
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
          const match =
            opts.search &&
            n.title.toLowerCase().includes(opts.search.toLowerCase());
          if (!focus && !match && scale < 0.16) continue;
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
      setZoom(Math.round((scale / baseScale) * 100));
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
    commands.current = {
      fit: () => fit(),
      zoom: (factor) => zoomAt(factor),
      focus: (id) => {
        const mapped = scene.owner.get(id) ?? id;
        const p = positions.get(mapped);
        if (p) {
          fit(p, 260);
          setSelected(id);
        }
      },
    };
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
        setSearch("");
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

  const radial = new URL(location.href);
  radial.searchParams.delete("renderer");
  return (
    <section className="fw-study" aria-label="Flywheel live-view study">
      <canvas
        ref={canvasRef}
        className="fw-canvas"
        tabIndex={0}
        aria-label={`Interactive orbital graph. ${nodes.length} source nodes. Scroll to zoom, drag to pan or move nodes. F fits, C folds, Escape clears selection.`}
      />
      <header className="fw-header">
        <span className="fw-wordmark">
          Flywheel <small>LOCAL STUDY</small>
        </span>
        <nav>
          <a href={radial.pathname + radial.search}>RADIAL EXPERIMENT</a>
          <button onClick={() => commands.current.fit()}>FIT GRAPH</button>
        </nav>
      </header>
      <button
        className="fw-view-toggle"
        aria-label="VIEW"
        onClick={() => setPanel(!panel)}
        aria-expanded={panel}
      >
        {panel ? "⌄" : "›"} VIEW
      </button>
      <span className="fw-zoom">ZOOM {zoom.toLocaleString()}%</span>
      {panel && (
        <aside className="fw-view-panel" aria-label="View controls">
          <label>
            Find a node
            <input
              placeholder="Search titles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {results.map((n) => (
            <button
              className="fw-result"
              key={n.id}
              onClick={() => commands.current.focus(n.id)}
            >
              {n.title}
            </button>
          ))}
          <label>
            <input
              type="checkbox"
              checked={guides}
              onChange={(e) => setGuides(e.target.checked)}
            />{" "}
            Orbital guides
          </label>
          <label>
            <input
              type="checkbox"
              checked={fold}
              onChange={(e) => setFold(e.target.checked)}
            />{" "}
            Fold runs & leaf fans
          </label>
          <label>
            <input
              type="checkbox"
              checked={citations}
              onChange={(e) => setCitations(e.target.checked)}
            />{" "}
            Citation edges
          </label>
          <label>
            <input
              type="checkbox"
              checked={labels}
              onChange={(e) => setLabels(e.target.checked)}
            />{" "}
            Labels
          </label>
          <div className="fw-actions">
            <button onClick={() => commands.current.zoom(1.5)}>+</button>
            <button onClick={() => commands.current.zoom(1 / 1.5)}>−</button>
            <button
              onClick={() => {
                setExpanded(new Set());
                commands.current.fit();
              }}
            >
              Reset
            </button>
          </div>
          <p>
            {nodes.length.toLocaleString()} nodes ·{" "}
            {edges.length.toLocaleString()} edges
            <br />
            {scene.nodes.length.toLocaleString()} displayed ·{" "}
            {scene.groups.size} folds · {scene.components.length} graphs
          </p>
        </aside>
      )}
      {selection && (
        <aside className="fw-detail" aria-label="Selected node">
          <button
            className="fw-close"
            onClick={() => setSelected(null)}
            aria-label="Close node"
          >
            ×
          </button>
          <small>NODE</small>
          <h2>{selection.title}</h2>
          <code>{selection.id}</code>
          <div className="fw-tags">
            {selection.tags?.map((t) => (
              <span key={t.id} style={{ borderColor: tagColor(t.id) }}>
                {t.name}
              </span>
            ))}
          </div>
          <p>
            {edges.filter((e) => e.target === selection.id).length} incoming ·{" "}
            {edges.filter((e) => e.source === selection.id).length} outgoing
          </p>
          <button onClick={() => commands.current.focus(selection.id)}>
            Center on node
          </button>
        </aside>
      )}
      <footer className="fw-help">
        Scroll or pinch to zoom · Drag to move through the graph
        <br />
        Click a graph’s outline to zoom to it · Click stacked circles to expand
        <br />F to fit · C to fold · Local, read-only graph
      </footer>
    </section>
  );
}
