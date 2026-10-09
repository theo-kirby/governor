import type { GraphNode } from "../shared/types";

export function nodeLabel(node: GraphNode, showTitle = true, showTags = true) {
  const title =
    node.title.length > 58 ? `${node.title.slice(0, 55)}…` : node.title;
  const names = [
    ...new Set(
      (node.tags || [])
        .map((tag) => tag.name.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ];
  const tags = names
    .slice(0, 2)
    .map((name) => `#${name.length > 18 ? `${name.slice(0, 17)}…` : name}`)
    .join(" · ");
  return [
    showTitle ? title : "",
    showTags && tags
      ? `${tags}${names.length > 2 ? ` +${names.length - 2}` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
