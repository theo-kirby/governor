import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, GraphEdge } from "../shared/types";
import type { GraphTuning } from "./GraphCanvas";
import { atlasFrontier, buildAtlas, type Region } from "./multiscale";
import { outwardBend } from "./edge-curves";

type Camera = { x: number; y: number; zoom: number };
type LinkMode = "focus" | "structure" | "all";

export function MultiscaleGraph({
  nodes,
  edges,
  label,
  tuning,
  onLayout,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label: string;
  tuning: GraphTuning;
  onLayout?: (milliseconds: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const camera = useRef<Camera | null>(null);
  const actions = useRef({ fit: () => {}, zoom: (_factor: number) => {} });
  const [detail, setDetail] = useState(100);
  const [capacity, setCapacity] = useState(24);
  const [links, setLinks] = useState<LinkMode>("focus");
  const [stats, setStats] = useState("");
  const [selection, setSelection] = useState("");
  const atlas = useMemo(() => {
    const started = performance.now();
    const result = buildAtlas(nodes, edges, {
      ...tuning,
      neighborhoodSize: capacity,
    });
    return { ...result, milliseconds: performance.now() - started };
  }, [nodes, edges, tuning.ringGap, tuning.spacing, capacity]);
  useEffect(() => {
    onLayout?.(atlas.milliseconds);
  }, [atlas, onLayout]);
  // Preserve the map while tags arrive; a changed topology/layout gets a fresh fit.
  const topologyKey = JSON.stringify([
    nodes.map((n) => n.id),
    edges.map((e) => [e.source, e.target, e.kind, e.relation]),
    capacity,
    tuning.ringGap,
    tuning.spacing,
  ]);
  const previousKey = useRef("");
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext("2d")!;
    let width = 1,
      height = 1,
      frame = 0;
    let selected: string | null = selectedRef.current;
    let hovered: Region | undefined;
    let visible: Region[] = [];
    let lastStats = "";
    let drag: {
      x: number;
      y: number;
      startX: number;
      startY: number;
      moved: boolean;
    } | null = null;
    const taggedIds = new Set(
      nodes
        .filter((node) =>
          node.tags?.some((tag) => tag.name === tuning.tagFilter),
        )
        .map((node) => node.id),
    );
    const view = camera.current || { x: 0, y: 0, zoom: 1 };
    camera.current = view;
    const screen = (r: Region) => ({
      x: r.x * view.zoom + view.x,
      y: r.y * view.zoom + view.y,
    });
    const radius = (r: Region) =>
      r.node
        ? Math.max(2, Math.min(28, r.radius * view.zoom))
        : Math.max(10, r.radius * view.zoom);
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const fit = () => {
      view.zoom = Math.min(
        1,
        Math.max(
          0.000001,
          Math.min(width - 100, height - 220) / (atlas.root.radius * 2),
        ),
      );
      view.x = width / 2;
      view.y = (height - 100) / 2;
      selected = null;
      setSelection("");
      schedule();
    };
    const zoomAt = (factor: number, x = width / 2, y = height / 2) => {
      const next = Math.max(0.000001, Math.min(8, view.zoom * factor));
      const ratio = next / view.zoom;
      view.x = x - (x - view.x) * ratio;
      view.y = y - (y - view.y) * ratio;
      view.zoom = next;
      schedule();
    };
    actions.current = { fit, zoom: (factor) => zoomAt(factor) };
    function draw() {
      frame = 0;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const frontier = atlasFrontier(atlas, view.zoom, detail);
      const frontierIds = new Set(frontier.items.map((r) => r.id));
      const selectedRegion = selected ? atlas.regions.get(selected) : undefined;
      const focused = new Set(
        selectedRegion?.members.map((id) => frontier.owner.get(id)) || [],
      );
      visible = frontier.items.filter((r) => {
        const p = screen(r),
          radius = r.radius * view.zoom;
        return (
          p.x + radius > -120 &&
          p.x - radius < width + 120 &&
          p.y + radius > -120 &&
          p.y - radius < height + 120
        );
      });
      // Expanded region outlines preserve context through changes in detail.
      for (const region of atlas.regions.values()) {
        if (region.node || frontierIds.has(region.id) || region === atlas.root)
          continue;
        const r = radius(region),
          p = screen(region);
        if (r < detail || r > Math.max(width, height) * 4) continue;
        ctx.strokeStyle = "#202020";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      let drawnLinks = 0;
      for (const link of frontier.links) {
        const incident = focused.has(link.source) || focused.has(link.target);
        if (
          link.kind === "cross" &&
          (links === "structure" ||
            (links === "focus" && nodes.length > 40 && !incident))
        )
          continue;
        const a = atlas.regions.get(link.source)!,
          b = atlas.regions.get(link.target)!;
        const p = screen(a),
          q = screen(b);
        // A curve can bend up to 100 world units beyond its endpoints.
        const margin =
          100 * view.zoom * tuning.curvature + Math.max(radius(a), radius(b));
        if (
          Math.max(p.x, q.x) + margin < 0 ||
          Math.min(p.x, q.x) - margin > width ||
          Math.max(p.y, q.y) + margin < 0 ||
          Math.min(p.y, q.y) - margin > height
        )
          continue;
        drawnLinks++;
        ctx.strokeStyle = incident
          ? "#d0d0d0"
          : link.kind === "cross"
            ? "#292929"
            : "#555555";
        ctx.lineWidth = Math.min(5, 0.7 + Math.log2(link.count + 1) * 0.5);
        ctx.setLineDash(link.kind === "cross" ? [3, 5] : []);
        ctx.beginPath();
        if (a === b) {
          ctx.arc(p.x, p.y - radius(a), radius(a) + 7, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        const distance = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const center =
          a.parent === b.parent && a.parent
            ? atlas.regions.get(a.parent)!
            : atlas.root;
        const bend =
          outwardBend(
            { x: a.x - center.x, y: a.y - center.y },
            { x: b.x - center.x, y: b.y - center.y },
          ) *
          tuning.curvature *
          view.zoom;
        const control = {
          x: (p.x + q.x) / 2 - ((q.y - p.y) / distance) * bend,
          y: (p.y + q.y) / 2 + ((q.x - p.x) / distance) * bend,
        };
        const sourceAngle = Math.atan2(control.y - p.y, control.x - p.x);
        const targetAngle = Math.atan2(q.y - control.y, q.x - control.x);
        const start = {
          x: p.x + Math.cos(sourceAngle) * radius(a),
          y: p.y + Math.sin(sourceAngle) * radius(a),
        };
        const end = {
          x: q.x - Math.cos(targetAngle) * radius(b),
          y: q.y - Math.sin(targetAngle) * radius(b),
        };
        ctx.moveTo(start.x, start.y);
        ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - 5 * Math.cos(targetAngle - 0.5),
          end.y - 5 * Math.sin(targetAngle - 0.5),
        );
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - 5 * Math.cos(targetAngle + 0.5),
          end.y - 5 * Math.sin(targetAngle + 0.5),
        );
        ctx.stroke();
        if (link.count > 1 && incident) {
          ctx.fillStyle = "#cccccc";
          ctx.font = "10px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(
            String(link.count),
            (p.x + 2 * control.x + q.x) / 4,
            (p.y + 2 * control.y + q.y) / 4 - 5,
          );
        }
      }
      ctx.setLineDash([]);
      for (const region of visible) {
        const p = screen(region),
          r = radius(region);
        const active = focused.has(region.id) || hovered?.id === region.id;
        ctx.globalAlpha =
          tuning.tagFilter && !region.members.some((id) => taggedIds.has(id))
            ? 0.18
            : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = region.node
          ? region.node.childCount
            ? "#555555"
            : "#222222"
          : "#080808";
        ctx.fill();
        ctx.strokeStyle = active
          ? "#ffffff"
          : region.node
            ? "#aaaaaa"
            : "#777777";
        ctx.lineWidth =
          active || (region.node && tuning.tags && region.node.tags?.length)
            ? 2
            : 1;
        if (!region.node) ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!region.node && r >= 10) {
          ctx.fillStyle = "#ffffff";
          ctx.font = `${Math.min(24, Math.max(11, r / 4))}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText(region.members.length.toLocaleString(), p.x, p.y + 1);
          ctx.font = "10px system-ui";
          ctx.fillStyle = "#888888";
          if (r >= 24) ctx.fillText("nodes", p.x, p.y + 17);
        }
        ctx.globalAlpha = 1;
      }
      // Screen-space label collision rejection, with selected / hovered labels first.
      const occupied = visible.map((region) => {
        const p = screen(region),
          r = radius(region);
        if (!region.node)
          return {
            x: p.x - Math.min(42, r),
            y: p.y - Math.min(24, r),
            w: Math.min(84, r * 2),
            h: r >= 24 ? 46 : 24,
          };
        return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
      });
      const priority = (r: Region) =>
        focused.has(r.id) || r.id === hovered?.id
          ? 1e9
          : !r.node
            ? 1e8
            : r.node.childCount * 100 + r.node.edgeCount;
      for (const region of [...visible].sort(
        (a, b) => priority(b) - priority(a),
      )) {
        if (!tuning.labels && region.node) continue;
        const r = radius(region),
          p = screen(region);
        if (
          region.node &&
          r < 3 &&
          !focused.has(region.id) &&
          hovered?.id !== region.id
        )
          continue;
        const title =
          region.title.length > 34
            ? `${region.title.slice(0, 32)}…`
            : region.title;
        const tags =
          tuning.tags && region.node?.tags?.map((t) => `#${t.name}`).join(" ");
        const lines = [
          region.node ? title : `Near ${title}`,
          ...(tags ? [tags.slice(0, 40)] : []),
        ];
        ctx.font = "11px system-ui";
        const w = Math.max(...lines.map((line) => ctx.measureText(line).width));
        const h = lines.length * 15 + 4;
        const candidates = [
          { x: p.x - w / 2 - 4, y: p.y + r + 5, w: w + 8, h },
          { x: p.x + r + 7, y: p.y - h / 2, w: w + 8, h },
          { x: p.x - r - w - 15, y: p.y - h / 2, w: w + 8, h },
          { x: p.x - w / 2 - 4, y: p.y - r - h - 5, w: w + 8, h },
        ];
        const box = candidates.find(
          (box) =>
            box.x >= 0 &&
            box.x + box.w <= width &&
            box.y >= 0 &&
            box.y + box.h <= height - 110 &&
            !occupied.some(
              (b) =>
                box.x < b.x + b.w &&
                box.x + box.w > b.x &&
                box.y < b.y + b.h &&
                box.y + box.h > b.y,
            ),
        );
        if (!box) continue;
        occupied.push(box);
        ctx.fillStyle = "#000000dd";
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.textAlign = "center";
        lines.forEach((line, i) => {
          ctx.fillStyle = i ? "#888888" : "#cccccc";
          ctx.fillText(line, box.x + box.w / 2, box.y + 12 + i * 15);
        });
      }
      const groups = visible.filter((r) => !r.node).length;
      const nextStats = `${nodes.length.toLocaleString()} total nodes · ${groups} groups + ${visible.length - groups} nodes on screen · ${drawnLinks} links drawn`;
      if (nextStats !== lastStats) {
        lastStats = nextStats;
        setStats(nextStats);
      }
      element.dataset.groups = String(groups);
      element.dataset.nodes = String(visible.length - groups);
      element.dataset.represented = String(
        frontier.items.reduce((sum, r) => sum + r.members.length, 0),
      );
      element.dataset.zoom = String(view.zoom);
      element.dataset.cameraX = String(view.x);
      element.dataset.cameraY = String(view.y);
    }
    const resize = () => {
      const rect = element.getBoundingClientRect();
      const oldWidth = width,
        oldHeight = height;
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      element.width = width * dpr;
      element.height = height * dpr;
      if (previousKey.current !== topologyKey) {
        previousKey.current = topologyKey;
        fit();
      } else if (oldWidth > 1) {
        view.x += (width - oldWidth) / 2;
        view.y += (height - oldHeight) / 2;
      }
      schedule();
    };
    const point = (event: MouseEvent) => {
      const r = element.getBoundingClientRect();
      return { x: event.clientX - r.left, y: event.clientY - r.top };
    };
    const hit = (x: number, y: number) =>
      [...visible].reverse().find((r) => {
        const p = screen(r);
        return Math.hypot(p.x - x, p.y - y) <= Math.max(8, radius(r));
      });
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = point(event);
      zoomAt(
        Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.003),
        p.x,
        p.y,
      );
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      element.focus();
      element.setPointerCapture(event.pointerId);
      const p = point(event);
      drag = { ...p, startX: p.x, startY: p.y, moved: false };
    };
    const move = (event: PointerEvent) => {
      const p = point(event);
      if (drag) {
        view.x += p.x - drag.x;
        view.y += p.y - drag.y;
        drag.moved ||= Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4;
        drag.x = p.x;
        drag.y = p.y;
      } else {
        hovered = hit(p.x, p.y);
        element.style.cursor = hovered ? "pointer" : "grab";
        element.title = hovered
          ? `${hovered.title}${hovered.node ? "" : ` · ${hovered.members.length} nodes · double-click to explore`}`
          : "";
      }
      schedule();
    };
    const up = (event: PointerEvent) => {
      if (drag && !drag.moved) {
        const p = point(event),
          region = hit(p.x, p.y);
        selected = region?.id || null;
        const frontier = atlasFrontier(atlas, view.zoom, detail);
        setSelection(
          region
            ? `${region.node ? "" : "Neighborhood near "}${region.title} · ${region.members.length} node${region.members.length === 1 ? "" : "s"}${region.node ? ` · ${region.node.tags?.map((t) => `#${t.name}`).join(" ") || "untagged"}` : ` · ${frontier.internal.get(region.id) || 0} internal relationships`}`
            : "",
        );
      }
      drag = null;
      schedule();
    };
    const doubleClick = (event: MouseEvent) => {
      const p = point(event),
        region = hit(p.x, p.y);
      if (!region || region.node) return;
      view.zoom = Math.min(
        8,
        Math.max(
          (detail + 30) / region.radius,
          (Math.min(width, height) - 150) / (region.radius * 2),
        ),
      );
      view.x = width / 2 - region.x * view.zoom;
      view.y = height / 2 - region.y * view.zoom;
      // Exploration should not expand an ancestor's selection into a screenful
      // of cross-links. Click a specific revealed node/group to trace it.
      selected = null;
      setSelection("");
      schedule();
    };
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const k = event.key.toLowerCase();
      if (
        [
          "f",
          "0",
          "+",
          "=",
          "-",
          "escape",
          "arrowleft",
          "arrowright",
          "arrowup",
          "arrowdown",
        ].includes(k)
      )
        event.preventDefault();
      if (k === "f" || k === "0") fit();
      if (k === "+" || k === "=") zoomAt(1.5);
      if (k === "-") zoomAt(1 / 1.5);
      if (k === "escape") {
        selected = null;
        setSelection("");
      }
      if (k === "arrowleft") view.x += 60;
      if (k === "arrowright") view.x -= 60;
      if (k === "arrowup") view.y += 60;
      if (k === "arrowdown") view.y -= 60;
      schedule();
    };
    const cancel = () => {
      drag = null;
      hovered = undefined;
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("dblclick", doubleClick);
    element.addEventListener("keydown", key);
    return () => {
      selectedRef.current = selected;
      observer.disconnect();
      cancelAnimationFrame(frame);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("dblclick", doubleClick);
      element.removeEventListener("keydown", key);
    };
  }, [atlas, topologyKey, detail, links, tuning]);

  return (
    <>
      <canvas
        ref={canvas}
        className="graph-canvas atlas-canvas"
        tabIndex={0}
        role="img"
        aria-label={`${label} with ${nodes.length} nodes and ${edges.length} relationships. Experimental multiscale radial map. Drag to pan, scroll to zoom, double-click a group to explore. Keyboard: arrows to pan, plus or minus to zoom, F to fit, Escape to clear selection.`}
      />
      <div className="atlas-tools" aria-label="Multiscale experiment controls">
        {selection && (
          <div className="atlas-selection" role="status">
            {selection}
          </div>
        )}
        <div className="atlas-stats" role="status">
          {stats}
        </div>
        <div className="atlas-controls">
          <span>RADIAL ATLAS · EXPERIMENT</span>
          <label>
            Detail{" "}
            <input
              aria-label="Level of detail"
              type="range"
              min="70"
              max="320"
              step="10"
              value={390 - detail}
              onChange={(e) => setDetail(390 - Number(e.target.value))}
            />
          </label>
          <label>
            Neighborhood{" "}
            <select
              aria-label="Neighborhood size"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            >
              <option value="16">16 nodes</option>
              <option value="24">24 nodes</option>
              <option value="40">40 nodes</option>
            </select>
          </label>
          <label>
            Links{" "}
            <select
              aria-label="Link visibility"
              value={links}
              onChange={(e) => setLinks(e.target.value as LinkMode)}
            >
              <option value="focus">Structure + selected cross-links</option>
              <option value="structure">Structure only</option>
              <option value="all">All relationships</option>
            </select>
          </label>
          <button
            onClick={() => actions.current.zoom(1 / 1.5)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            onClick={() => actions.current.zoom(1.5)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button onClick={() => actions.current.fit()}>Fit</button>
        </div>
        <div className="atlas-hint">
          Dashed circles summarize nodes. Click to trace connections;
          double-click to explore. Scroll to zoom. F fits everything.
        </div>
      </div>
    </>
  );
}
