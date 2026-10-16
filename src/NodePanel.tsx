import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GraphEdge, GraphNode, NodeDetail } from "../shared/types";

export type LoadNode = (
  id: string,
  signal: AbortSignal,
) => Promise<NodeDetail | null>;
type Props = {
  id: string;
  side: "left" | "right";
  open: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  load: LoadNode;
  onSelect: (id: string) => void;
  onClose: () => void;
  onClosed: () => void;
};

export function NodePanel({
  id,
  side,
  open,
  nodes,
  edges,
  load,
  onSelect,
  onClose,
  onClosed,
}: Props) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const node = byId.get(id);
  const [detail, setDetail] = useState<{
    id: string;
    node?: NodeDetail | null;
    error?: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    load(id, controller.signal).then(
      (node) => !controller.signal.aborted && setDetail({ id, node }),
      (error) =>
        !controller.signal.aborted &&
        setDetail({
          id,
          error: error instanceof Error ? error.message : "Read failed.",
        }),
    );
    return () => controller.abort();
  }, [id, load]);

  const connections = useMemo(() => {
    const groups: [string, string[]][] = [
      ["Parents", []],
      ["Children", []],
      ["Cites", []],
      ["Cited by", []],
    ];
    const seen = new Set<string>();
    for (const e of edges) {
      if (e.source !== id && e.target !== id) continue;
      const outgoing = e.source === id;
      const other = outgoing ? e.target : e.source;
      const parentLink = e.relation === "parent" || e.kind === "containment";
      const group = parentLink ? (outgoing ? 1 : 0) : outgoing ? 2 : 3;
      const key = `${group}:${other}`;
      if (other === id || seen.has(key) || !byId.has(other)) continue;
      seen.add(key);
      groups[group][1].push(other);
    }
    return groups.filter(([, ids]) => ids.length);
  }, [edges, id, byId]);

  const current = detail?.id === id ? detail : null;
  const body = current?.node;
  const created = node?.createdAt ? new Date(node.createdAt) : null;
  return (
    <aside
      className={`node-panel node-panel-${side}${open ? "" : " closing"}`}
      aria-label="Node details"
      onAnimationEnd={() => !open && onClosed()}
    >
      <header className="node-panel-header">
        <div className="node-panel-tags">
          {node?.tags?.map((tag) => (
            <span key={`${tag.scope ?? ""}:${tag.id}`}>{tag.name}</span>
          ))}
        </div>
        <button
          className="node-panel-close"
          onClick={onClose}
          aria-label="Close node details"
          title="Close (Esc)"
        >
          ×
        </button>
      </header>
      <div className="node-panel-scroll">
        <h2>{body?.title || node?.title || "Node"}</h2>
        <p className="node-panel-meta">
          {[
            body?.slug,
            created && !isNaN(+created) ? created.toLocaleString() : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {body?.summary && <p className="node-panel-summary">{body.summary}</p>}
        {!current ? (
          <p className="node-panel-note">Loading…</p>
        ) : current.error ? (
          <p className="node-panel-note">{current.error}</p>
        ) : body?.content ? (
          <article className="node-panel-body">
            <Markdown
              text={body.content}
              refs={body.refs ?? {}}
              titleOf={(ref) => byId.get(ref)?.title}
              onSelect={onSelect}
            />
          </article>
        ) : (
          <p className="node-panel-note">No body text.</p>
        )}
        {connections.map(([label, ids]) => (
          <section className="node-panel-links" key={label}>
            <h3>
              {label} <span>{ids.length}</span>
            </h3>
            <ul>
              {ids.map((other) => (
                <li key={other}>
                  <button onClick={() => onSelect(other)}>
                    {byId.get(other)!.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="node-panel-id">{id}</p>
      </div>
    </aside>
  );
}

// A small markdown subset (headings, lists, quotes, code, rules, emphasis, links),
// built as React elements so node text is never parsed as HTML.
type Inline = {
  refs: Record<string, string>;
  titleOf: (id: string) => string | undefined;
  onSelect: (id: string) => void;
};
function Markdown({ text, ...inline }: Inline & { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const key = () => blocks.length;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++)
        code.push(lines[i]);
      i++;
      blocks.push(
        <pre key={key()}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const Tag = `h${Math.min(6, heading[1].length + 2)}` as "h3";
      blocks.push(<Tag key={key()}>{spans(heading[2], inline)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++)
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={key()}>
          <Markdown text={quote.join("\n")} {...inline} />
        </blockquote>,
      );
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+/;
    if (item.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        if (item.test(lines[i])) items.push(lines[i].replace(item, ""));
        else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length)
          items[items.length - 1] += " " + lines[i].trim();
        else break;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key()}>
          {items.map((text, n) => (
            <li key={n}>{spans(text, inline)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraph: string[] = [];
    for (
      ;
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\s*(```|~~~|>)|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]);
      i++
    )
      paragraph.push(lines[i].trim());
    blocks.push(<p key={key()}>{spans(paragraph.join(" "), inline)}</p>);
  }
  return <>{blocks}</>;
}

const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|\[(rec|state|plan):\s*([a-zA-Z0-9_-]+)\s*\]|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<![\w*])\*(?!\s)(.+?)\*(?!\w)/g;
function spans(text: string, inline: Inline): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = m.index;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined)
      out.push(<strong key={k}>{spans(m[2], inline)}</strong>);
    else if (m[3] !== undefined) {
      const target = inline.refs[`${m[3]}:${m[4]}`];
      out.push(
        target ? (
          <button
            key={k}
            className="node-panel-ref"
            onClick={() => inline.onSelect(target)}
            title={inline.titleOf(target)}
          >
            {m[3]}: {m[4]}
          </button>
        ) : (
          <Fragment key={k}>{m[0]}</Fragment>
        ),
      );
    } else if (m[5] !== undefined)
      out.push(
        <a key={k} href={m[6]} target="_blank" rel="noreferrer noopener">
          {m[5]}
        </a>,
      );
    else out.push(<em key={k}>{spans(m[7], inline)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
