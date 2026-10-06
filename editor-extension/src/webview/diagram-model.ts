import type {
  DiagramView,
  GraphSide,
  PositionedEdge,
  PositionedNode,
} from "../shared/diagram-view.js";

export type GraphMode = "before" | "after" | "diff";

/** Nodes and edges for the current beat. An edge without its own beats is
 * highlighted when both of its ends are. */
export function highlighted(view: DiagramView, beatId: string | null) {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (!beatId) return { nodes, edges };
  for (const node of view.layout.nodes)
    if (node.beatIds.includes(beatId)) nodes.add(node.id);
  for (const edge of view.layout.edges)
    if (
      edge.beatIds.includes(beatId) ||
      (!edge.beatIds.length && nodes.has(edge.from) && nodes.has(edge.to))
    )
      edges.add(edge.id);
  return { nodes, edges };
}

const side = (mode: GraphMode): GraphSide | null =>
  mode === "diff" ? null : mode;

export function visible<T extends PositionedNode | PositionedEdge>(
  items: T[],
  mode: GraphMode,
): T[] {
  const wanted = side(mode);
  return items.filter((item) => !wanted || item.sides.includes(wanted));
}

/** Diff is the default when a matching before graph exists. */
export function defaultMode(view: DiagramView): GraphMode {
  return view.hasBefore && view.diffable ? "diff" : "after";
}

/** Reading order for keyboard focus: top to bottom, then left to right. */
export function readingOrder(nodes: PositionedNode[]) {
  return [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function nodeLabel(node: PositionedNode, mode: GraphMode) {
  const parts = [node.label];
  if (node.sublabel) parts.push(node.sublabel);
  if (mode === "diff" && node.status !== "unchanged") parts.push(node.status);
  if (mode === "diff" && node.was) parts.push(`was: ${node.was}`);
  for (const claim of node.claims) parts.push(`${claim.id} ${claim.status}`);
  parts.push(node.location ? `jumps to ${node.location}` : "no code location");
  return parts.join(", ");
}

/** Beat chips for the expanded view: beats that map to at least one node. */
export function beatStrip(
  view: DiagramView,
  beats: { id: string }[],
): { id: string; label: string; index: number }[] {
  return beats.flatMap((beat, index) => {
    const node = view.layout.nodes.find((n) => n.beatIds.includes(beat.id));
    if (!node) return [];
    const label =
      node.label.length > 22
        ? `${node.label.slice(0, 21).trimEnd()}…`
        : node.label;
    return [{ id: beat.id, label, index }];
  });
}
