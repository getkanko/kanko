import type {
  DiagramView,
  GraphSide,
  PositionedEdge,
  PositionedNode,
} from "../shared/diagram-view.js";

export type GraphMode = "before" | "after" | "diff";

/** Nodes and edges for the current beat. An edge without its own beats is
 * highlighted when both of its ends are. */
export function highlighted(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  beatId: string | null,
) {
  const hotNodes = new Set<string>();
  const hotEdges = new Set<string>();
  if (!beatId) return { nodes: hotNodes, edges: hotEdges };
  for (const node of nodes)
    if (node.beatIds.includes(beatId)) hotNodes.add(node.id);
  for (const edge of edges)
    if (
      edge.beatIds.includes(beatId) ||
      (!edge.beatIds.length && hotNodes.has(edge.from) && hotNodes.has(edge.to))
    )
      hotEdges.add(edge.id);
  return { nodes: hotNodes, edges: hotEdges };
}

/** Items shown in a mode, with each shared item's text, code location and
 * beats taken from that revision. Diff shows only the after route of an edge
 * whose endpoints changed. */
export function inMode(view: DiagramView, mode: GraphMode) {
  const wanted: GraphSide | null = mode === "diff" ? null : mode;
  const nodes = view.layout.nodes
    .filter((n) => !wanted || n.sides.includes(wanted))
    .map((n) => {
      if (mode !== "before" || !n.before) return n;
      const { sublabel: _, location: __, ...rest } = n;
      return { ...rest, ...n.before };
    });
  const shown = new Set(nodes.map((n) => n.id));
  const edges = view.layout.edges
    .filter((e) => (wanted ? e.sides.includes(wanted) : !e.variant))
    .filter((e) => shown.has(e.from) && shown.has(e.to))
    .map((e) =>
      mode === "before" && e.beforeLabel !== undefined
        ? { ...e, label: e.beforeLabel || undefined }
        : e,
    );
  return { nodes, edges };
}

/** Which revision's anchor a click in this mode should follow. */
export function sideOf(node: PositionedNode, mode: GraphMode): GraphSide {
  return mode === "before" || !node.sides.includes("after")
    ? "before"
    : "after";
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
