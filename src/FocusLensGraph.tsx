import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, GraphEdge } from "../shared/types";
import { buildAtlas } from "./multiscale";
import { projectFocus } from "./focus-lens";
import { outwardBend } from "./edge-curves";

export function FocusLensGraph({
  nodes,
  edges,
  label = "Graph",
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const atlas = useMemo(() => buildAtlas(nodes, edges), [nodes, edges]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const topologyKey = JSON.stringify([
    nodes.map((node) => node.id),
    edges.map((edge) => [edge.source, edge.target, edge.kind, edge.relation]),
  ]);
  useEffect(() => {
    setFocusId(null);
    setSelected(null);
  }, [topologyKey]);
  const [allLinks, setAllLinks] = useState(nodes.length <= 40);
  const view = useMemo(
    () =>
      projectFocus(atlas, focusId || atlas.root.id, size.width, size.height),
    [atlas, focusId, size],
  );
  const contextIds = new Set(view.context.map((r) => r.id));
  useEffect(() => {
    const element = container.current!;
    const resize = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: Math.max(200, rect.height - 140) });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  const focus = (id: string | null) => {
    setFocusId(id);
    setSelected(null);
  };
  const back = () => focus(view.focus.parent || null);
  const ancestors = [];
  let ancestor = view.focus;
  while (ancestor.parent) {
    ancestor = atlas.regions.get(ancestor.parent)!;
    ancestors.unshift(ancestor);
  }
  const labels: { id: string; x: number; y: number; text: string }[] = [];
  const occupied = view.items.map((item) => {
    const p = view.points.get(item.id)!;
    return {
      x: p.x - p.radius,
      y: p.y - p.radius,
      w: p.radius * 2,
      h: p.radius * 2,
    };
  });
  for (const item of [...view.items].sort(
    (a, b) => Number(b.id === selected) - Number(a.id === selected),
  )) {
    const p = view.points.get(item.id)!;
    const limit = contextIds.has(item.id) ? 22 : 38;
    const title =
      item.title.length > limit
        ? `${item.title.slice(0, limit - 1)}…`
        : item.title;
    const w = title.length * 6;
    const h = 15;
    const candidates = [
      { x: p.x - w / 2, y: p.y + p.radius + 8, w, h },
      { x: p.x + p.radius + 8, y: p.y - h / 2, w, h },
      { x: p.x - p.radius - w - 8, y: p.y - h / 2, w, h },
    ];
    const box = candidates.find(
      (box) =>
        box.x >= 4 &&
        box.x + box.w < size.width - 4 &&
        box.y >= 4 &&
        box.y + box.h < size.height &&
        !occupied.some(
          (b) =>
            box.x < b.x + b.w &&
            box.x + box.w > b.x &&
            box.y < b.y + b.h &&
            box.y + box.h > b.y,
        ),
    );
    if (box) {
      occupied.push(box);
      labels.push({
        id: item.id,
        x: box.x + w / 2,
        y: box.y + 11,
        text: title,
      });
    }
  }
  const selectedRegion = selected ? atlas.regions.get(selected) : null;
  const links = view.links.filter(
    (link) =>
      allLinks ||
      link.kind === "structure" ||
      link.source === selected ||
      link.target === selected,
  );
  return (
    <div
      ref={container}
      className="graph-canvas focus-workspace"
      onKeyDown={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          (event.target as HTMLElement).tagName === "INPUT"
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          back();
        }
        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          focus(null);
        }
      }}
    >
      <svg
        className="focus-map"
        width="100%"
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        aria-label={`${label}. Focus lens with ${nodes.length} total nodes, ${view.detail.length} detail items and ${view.context.length} context groups.`}
        data-represented={view.items.reduce(
          (sum, item) => sum + item.members.length,
          0,
        )}
        data-focus={view.focus.id}
        onClick={() => setSelected(null)}
      >
        <defs>
          <marker
            id="focus-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L6,3.5 L0,7" fill="none" stroke="#888" />
          </marker>
        </defs>
        <circle
          cx={view.center.x}
          cy={view.center.y}
          r={view.lens}
          fill="#050505"
          stroke="#303030"
        />
        {view.context.length > 0 && (
          <circle
            cx={view.center.x}
            cy={view.center.y}
            r={view.orbit}
            fill="none"
            stroke="#171717"
            strokeDasharray="2 8"
          />
        )}
        {links.map((link) => {
          const a = view.points.get(link.source)!,
            b = view.points.get(link.target)!;
          const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const bend = outwardBend(
            { x: a.x - view.center.x, y: a.y - view.center.y },
            { x: b.x - view.center.x, y: b.y - view.center.y },
          );
          const c = {
            x: (a.x + b.x) / 2 - ((b.y - a.y) / distance) * bend,
            y: (a.y + b.y) / 2 + ((b.x - a.x) / distance) * bend,
          };
          const aa = Math.atan2(c.y - a.y, c.x - a.x),
            ba = Math.atan2(b.y - c.y, b.x - c.x);
          const path =
            link.source === link.target
              ? `M ${a.x} ${a.y - a.radius} C ${a.x - 40} ${a.y - 60}, ${a.x + 40} ${a.y - 60}, ${a.x + 2} ${a.y - a.radius}`
              : `M ${a.x + Math.cos(aa) * a.radius} ${a.y + Math.sin(aa) * a.radius} Q ${c.x} ${c.y} ${b.x - Math.cos(ba) * b.radius} ${b.y - Math.sin(ba) * b.radius}`;
          const active = link.source === selected || link.target === selected;
          return (
            <path
              key={`${link.source}/${link.target}/${link.kind}`}
              d={path}
              fill="none"
              stroke={active ? "#eee" : link.kind === "cross" ? "#333" : "#777"}
              strokeWidth={Math.min(4, 0.8 + Math.log2(link.count + 1) * 0.4)}
              strokeDasharray={link.kind === "cross" ? "3 5" : undefined}
              markerEnd="url(#focus-arrow)"
            >
              <title>
                {link.count} {link.kind} relationship
                {link.count === 1 ? "" : "s"}
              </title>
            </path>
          );
        })}
        {view.items.map((item) => {
          const p = view.points.get(item.id)!;
          const context = contextIds.has(item.id);
          const activate = () =>
            item.node ? setSelected(item.id) : focus(item.id);
          return (
            <g
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`${item.node ? "Select" : "Explore"} ${item.title}, ${item.members.length} nodes${context ? ", context" : ""}`}
              className="focus-item"
              data-region={item.id}
              data-kind={item.node ? "node" : "group"}
              data-context={context ? "1" : "0"}
              onClick={(event) => {
                event.stopPropagation();
                activate();
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelected(item.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate();
                }
                if (event.key.toLowerCase() === "t") setSelected(item.id);
              }}
            >
              <title>
                {item.title}
                {item.node
                  ? `\n${item.node.tags?.map((t) => `#${t.name}`).join(" ") || ""}`
                  : `\n${item.members.length} nodes · ${view.internal.get(item.id) || 0} internal relationships\nClick to explore; right-click or T to trace connections`}
              </title>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.radius}
                fill={item.node ? "#333" : "#0c0c0c"}
                stroke={
                  item.id === selected ? "#fff" : context ? "#666" : "#bbb"
                }
                strokeWidth={
                  item.id === selected || item.node?.tags?.length ? 2 : 1
                }
                strokeDasharray={item.node ? undefined : "3 4"}
              />
              {!item.node && (
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  fill="#ddd"
                  fontSize={context ? 11 : 13}
                >
                  {item.members.length.toLocaleString()}
                </text>
              )}
            </g>
          );
        })}
        {labels.map((l) => (
          <text
            key={l.id}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            fill={contextIds.has(l.id) ? "#888" : "#ccc"}
            fontSize="11"
            pointerEvents="none"
            paintOrder="stroke"
            stroke="#000"
            strokeWidth="4"
          >
            {l.text}
          </text>
        ))}
      </svg>
      <div className="atlas-tools focus-tools">
        <div className="atlas-stats">
          {nodes.length.toLocaleString()} total nodes ·{" "}
          {view.focus.members.length.toLocaleString()} in focus ·{" "}
          {nodes.length - view.focus.members.length} in context · {links.length}{" "}
          links drawn
        </div>
        <div className="atlas-controls">
          <span>ORBITAL FOCUS · EXPERIMENT 2</span>
          <button onClick={() => focus(null)}>Whole graph</button>
          <button disabled={!view.focus.parent} onClick={back}>
            Back to parent
          </button>
          <label>
            <input
              type="checkbox"
              checked={allLinks}
              onChange={(e) => setAllLinks(e.target.checked)}
            />
            All cross-links
          </label>
          <a
            href={`${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), lens: "0", lod: "1" })}`}
          >
            Compare radial atlas
          </a>
        </div>
        <div className="focus-path" aria-label="Focus path">
          {ancestors.map((a) => (
            <button key={a.id} onClick={() => focus(a.id)}>
              {a === atlas.root ? "Whole graph" : a.title}
            </button>
          ))}
          <span>
            {view.focus === atlas.root ? "Whole graph" : view.focus.title}
          </span>
        </div>
        {selectedRegion && (
          <div role="status" className="atlas-selection">
            {selectedRegion.title} · {selectedRegion.members.length} nodes ·{" "}
            {selectedRegion.node?.tags?.map((t) => `#${t.name}`).join(" ") ||
              `${view.internal.get(selectedRegion.id) || 0} internal relationships`}
          </div>
        )}
        <div className="atlas-hint">
          Click a group to expand it in the center. The outer ring summarizes
          everything else. Click a node to trace links; right-click a group or
          press T to trace it.
        </div>
      </div>
    </div>
  );
}
