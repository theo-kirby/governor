import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, GraphEdge } from "../shared/types";
import type { GraphTuning } from "./GraphCanvas";
import { riverLayout, type Point } from "./rivers";

export function RiverGraph({
  nodes,
  edges,
  tuning,
  onLayout,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tuning: GraphTuning;
  onLayout?: (ms: number) => void;
}) {
  const [fold, setFold] = useState(10);
  const [ranker, setRanker] = useState("network-simplex");
  const [links, setLinks] = useState("selected");
  const [selected, setSelected] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const actions = useRef({ fit() {}, zoom(_factor: number) {} });
  const saved = useRef<{
    key: string;
    x: number;
    y: number;
    zoom: number;
  } | null>(null);
  const key = JSON.stringify([
    nodes.map((n) => n.id),
    edges.map((e) => [e.id, e.source, e.target, e.kind, e.relation]),
    fold,
    ranker,
  ]);
  // Tags and presentation changes must not re-run Dagre or move the camera.
  const layout = useMemo(
    () => riverLayout(nodes, edges, { fold, ranker }),
    [key],
  );
  useEffect(() => {
    onLayout?.(layout.ms);
  }, [layout, onLayout]);
  useEffect(() => {
    setSelected(null);
    setCaption("");
  }, [key]);
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    let width = 1,
      height = 1,
      zoom = 1,
      x = 0,
      y = 0,
      hover: string | null = null;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const screen = (p: Point) => ({ x: p.x * zoom + x, y: p.y * zoom + y });
    const active = selected && byId.has(selected) ? selected : null;
    const neighbors = new Set<string>(active ? [active] : []);
    if (active)
      for (const e of edges) {
        if (e.source === active) neighbors.add(e.target);
        if (e.target === active) neighbors.add(e.source);
      }
    function draw() {
      ctx.clearRect(0, 0, width, height);
      const radius = Math.max(1.5, Math.min(8, 5 * zoom));
      let drawn = 0;
      for (const e of edges) {
        const points = layout.routes.get(e.id);
        if (!points) continue;
        const structural = layout.structural.has(e.id);
        const incident = e.source === active || e.target === active;
        if (
          !structural &&
          links !== "all" &&
          !(links === "selected" && incident)
        )
          continue;
        const sameThread =
          active &&
          layout.owner.get(e.source) === layout.owner.get(active) &&
          layout.owner.get(e.target) === layout.owner.get(active);
        ctx.strokeStyle = incident
          ? "#ededed"
          : active
            ? sameThread
              ? "#999"
              : "#242424"
            : structural
              ? "#666"
              : "#303030";
        ctx.lineWidth = incident ? 1.5 : structural ? 1 : 0.65;
        ctx.setLineDash(structural ? [] : [3, 4]);
        const p = points.map(screen),
          a = p[0],
          b = p[p.length - 1];
        let tangent = p[p.length - 2];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        if (e.source === e.target) {
          ctx.arc(
            a.x + radius,
            a.y - radius * 2,
            radius * 2,
            Math.PI / 2,
            Math.PI * 2.5,
          );
        } else if (p.length > 2) {
          for (let i = 1; i < p.length - 1; i++)
            ctx.quadraticCurveTo(
              p[i].x,
              p[i].y,
              (p[i].x + p[i + 1].x) / 2,
              (p[i].y + p[i + 1].y) / 2,
            );
          ctx.lineTo(b.x, b.y);
        } else if (
          structural &&
          Math.abs(a.y - b.y) > 1 &&
          Math.abs(a.x - b.x) < 1
        ) {
          const thread = layout.threads[layout.owner.get(e.source)!];
          const row = Math.floor(thread.indexOf(e.source) / fold);
          const bend = (row % 2 ? -1 : 1) * 22 * zoom;
          tangent = { x: b.x + bend, y: b.y };
          ctx.bezierCurveTo(a.x + bend, a.y, b.x + bend, b.y, b.x, b.y);
        } else if (!structural) {
          const bend = Math.min(100, Math.hypot(b.x - a.x, b.y - a.y) * 0.2);
          tangent = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - bend };
          ctx.quadraticCurveTo(
            (a.x + b.x) / 2,
            (a.y + b.y) / 2 - bend,
            b.x,
            b.y,
          );
        } else ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if ((incident || zoom > 1.2) && e.source !== e.target) {
          const prev = tangent;
          const angle = Math.atan2(b.y - prev.y, b.x - prev.x);
          const end = {
            x: b.x - Math.cos(angle) * (radius + 2),
            y: b.y - Math.sin(angle) * (radius + 2),
          };
          ctx.beginPath();
          ctx.moveTo(
            end.x - Math.cos(angle - 0.45) * 5,
            end.y - Math.sin(angle - 0.45) * 5,
          );
          ctx.lineTo(end.x, end.y);
          ctx.lineTo(
            end.x - Math.cos(angle + 0.45) * 5,
            end.y - Math.sin(angle + 0.45) * 5,
          );
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      for (const n of nodes) {
        const p = screen(layout.positions.get(n.id)!);
        if (p.x < -10 || p.y < -10 || p.x > width + 10 || p.y > height + 10)
          continue;
        drawn++;
        const highlighted = neighbors.has(n.id) || n.id === hover;
        const thread =
          active && layout.owner.get(n.id) === layout.owner.get(active);
        const matches =
          !tuning.tagFilter || n.tags?.some((t) => t.name === tuning.tagFilter);
        ctx.fillStyle = !matches
          ? "#252525"
          : highlighted
            ? "#fff"
            : active && !thread
              ? "#444"
              : "#bfbfbf";
        ctx.beginPath();
        ctx.arc(p.x, p.y, highlighted ? radius + 1.2 : radius, 0, Math.PI * 2);
        ctx.fill();
        if (n.id === active || (tuning.tags && n.tags?.length && zoom > 0.65)) {
          ctx.strokeStyle = n.id === active ? "#fff" : "#777";
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      const occupied: { x: number; y: number; w: number }[] = [];
      ctx.font = "11px system-ui";
      const priority = [...nodes].sort(
        (a, b) =>
          Number(b.id === hover || b.id === active) -
          Number(a.id === hover || a.id === active),
      );
      for (const n of priority) {
        const important = n.id === active || n.id === hover;
        if (!important && (!tuning.labels || zoom < 0.8)) continue;
        const p = screen(layout.positions.get(n.id)!);
        if (p.x < 0 || p.y < 0 || p.x > width || p.y > height - 110) continue;
        const title =
          n.title.length > 48 ? n.title.slice(0, 47) + "…" : n.title;
        const w = ctx.measureText(title).width;
        const box = { x: p.x - w / 2, y: p.y + radius + 9, w };
        if (
          !important &&
          occupied.some(
            (b) =>
              Math.abs(b.y - box.y) < 16 &&
              b.x < box.x + w + 8 &&
              box.x < b.x + b.w + 8,
          )
        )
          continue;
        occupied.push(box);
        ctx.fillStyle = "#000d";
        ctx.fillRect(box.x - 3, box.y - 3, w + 6, 16);
        ctx.fillStyle = important ? "#fff" : "#aaa";
        ctx.fillText(title, box.x, box.y + 9);
      }
      el.dataset.drawn = String(drawn);
      el.dataset.zoom = String(zoom);
      el.dataset.cameraX = String(x);
      el.dataset.cameraY = String(y);
      saved.current = { key, x, y, zoom };
    }
    function fit() {
      zoom = Math.min(
        (width - 80) / layout.width,
        (height - 170) / layout.height,
        2,
      );
      zoom = Math.max(0.005, zoom);
      x = (width - layout.width * zoom) / 2;
      y = (height - 100 - layout.height * zoom) / 2;
      draw();
    }
    function scale(factor: number, px = width / 2, py = height / 2) {
      const next = Math.min(12, Math.max(0.005, zoom * factor));
      x = px - ((px - x) * next) / zoom;
      y = py - ((py - y) * next) / zoom;
      zoom = next;
      draw();
    }
    actions.current = { fit, zoom: scale };
    function resize() {
      const rect = el.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = devicePixelRatio || 1;
      el.width = width * dpr;
      el.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (saved.current?.key === key) {
        ({ x, y, zoom } = saved.current);
        draw();
      } else fit();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    function hit(px: number, py: number) {
      let best: string | null = null,
        dist = 12;
      for (const [id, p] of layout.positions) {
        const s = screen(p),
          d = Math.hypot(s.x - px, s.y - py);
        if (d < dist) {
          dist = d;
          best = id;
        }
      }
      return best;
    }
    function point(e: PointerEvent | WheelEvent) {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.focus();
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        x += dx;
        y += dy;
        drag.x = e.clientX;
        drag.y = e.clientY;
        draw();
      } else {
        const p = point(e);
        hover = hit(p.x, p.y);
        el.style.cursor = hover ? "pointer" : "grab";
        el.title = hover ? byId.get(hover)!.title : "";
        draw();
      }
    };
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved) {
        const p = point(e),
          id = hit(p.x, p.y);
        setSelected(id);
        setCaption(id ? byId.get(id)!.title : "");
      }
      drag = null;
    };
    const cancel = () => {
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = point(e);
      scale(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (
        [
          "f",
          "0",
          "Escape",
          "+",
          "=",
          "-",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(e.key)
      ) {
        e.preventDefault();
        if (e.key === "f" || e.key === "0") fit();
        else if (e.key === "Escape") {
          setSelected(null);
          setCaption("");
        } else if (e.key === "+" || e.key === "=") scale(1.3);
        else if (e.key === "-") scale(1 / 1.3);
        else {
          x += e.key === "ArrowLeft" ? 60 : e.key === "ArrowRight" ? -60 : 0;
          y += e.key === "ArrowUp" ? 60 : e.key === "ArrowDown" ? -60 : 0;
          draw();
        }
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("keydown", keyboard);
    return () => {
      observer.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("keydown", keyboard);
    };
  }, [layout, nodes, edges, links, selected, tuning, key, fold]);
  const radial = new URL(location.href);
  radial.searchParams.delete("rivers");
  radial.searchParams.delete("lod");
  return (
    <>
      <canvas
        ref={canvas}
        className="graph-canvas atlas-canvas river-canvas"
        tabIndex={0}
        role="img"
        aria-label={`Research rivers: ${nodes.length} nodes. Drag to pan, scroll to zoom, F to fit. Click a node to trace relationships.`}
        data-nodes={nodes.length}
        data-selected={selected || ""}
      />
      <div className="atlas-tools river-tools">
        <div className="atlas-controls">
          <span>RESEARCH RIVERS</span>
          <span>
            {nodes.length.toLocaleString()} nodes · {layout.threads.length}{" "}
            threads
          </span>
          <label>
            Fold{" "}
            <input
              aria-label="Thread fold"
              type="range"
              min="3"
              max="24"
              value={fold}
              onChange={(e) => setFold(Number(e.target.value))}
            />
            {fold}
          </label>
          <label>
            Ranker{" "}
            <select value={ranker} onChange={(e) => setRanker(e.target.value)}>
              <option>network-simplex</option>
              <option>tight-tree</option>
              <option>longest-path</option>
            </select>
          </label>
          <label>
            Cross-links{" "}
            <select value={links} onChange={(e) => setLinks(e.target.value)}>
              <option value="selected">Selected</option>
              <option value="all">All</option>
              <option value="none">None</option>
            </select>
          </label>
          <button
            onClick={() => actions.current.zoom(1 / 1.4)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            onClick={() => actions.current.zoom(1.4)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button onClick={() => actions.current.fit()}>Fit</button>
          <a href={radial.pathname + radial.search}>Compare radial</a>
        </div>
        <p className="river-caption">
          {caption ||
            "Every circle is a node. Follow the winding threads; click to trace evidence. Scroll to zoom · drag to pan · F to fit · Esc to clear"}
        </p>
      </div>
    </>
  );
}
