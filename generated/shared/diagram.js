// Generated from TypeScript. Run npm run runtime:build in editor-extension.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shortRev =
  exports.kindLabel =
  exports.DEFAULT_DIAGRAM_SETTINGS =
  exports.DIAGRAM_LIMITS =
  exports.EDGE_KINDS =
  exports.NODE_SHAPES =
  exports.DIAGRAM_KINDS =
    void 0;
exports.readDiagramSettings = readDiagramSettings;
exports.provenanceLabel = provenanceLabel;
exports.revisionLabel = revisionLabel;
exports.diffGraphs = diffGraphs;
exports.readingOrder = readingOrder;
exports.describeGraph = describeGraph;
exports.ariaSummary = ariaSummary;
exports.diagramAnchors = diagramAnchors;
exports.DIAGRAM_KINDS = ["flow", "sequence", "state", "dataflow", "timeline"];
exports.NODE_SHAPES = [
  "start",
  "decision",
  "action",
  "terminal",
  "state",
  "participant",
  "span",
];
exports.EDGE_KINDS = ["flow", "call", "return", "transition", "data", "wait"];
exports.DIAGRAM_LIMITS = { card: 12, expanded: 40, beatNodes: 3 };
exports.DEFAULT_DIAGRAM_SETTINGS = {
  mode: "auto",
  maxPerStop: 1,
  derivedOnly: false,
  openBeside: "ask",
};
const KIND_LABELS = {
  flow: "Flow",
  sequence: "Sequence",
  state: "State machine",
  dataflow: "Data flow",
  timeline: "Timeline",
};
const kindLabel = (kind) => KIND_LABELS[kind];
exports.kindLabel = kindLabel;
function readDiagramSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const max = input.maxPerStop;
  return {
    mode:
      input.mode === "auto" ||
      input.mode === "onRequest" ||
      input.mode === "off"
        ? input.mode
        : exports.DEFAULT_DIAGRAM_SETTINGS.mode,
    maxPerStop:
      typeof max === "number" && Number.isInteger(max) && max >= 0 && max <= 3
        ? max
        : exports.DEFAULT_DIAGRAM_SETTINGS.maxPerStop,
    derivedOnly: input.derivedOnly === true,
    openBeside:
      input.openBeside === "always" || input.openBeside === "never"
        ? input.openBeside
        : "ask",
  };
}
const shortRev = (rev) =>
  rev.startsWith("WORKTREE:") ? "working snapshot" : rev.slice(0, 7);
exports.shortRev = shortRev;
const basename = (path) => path.slice(path.lastIndexOf("/") + 1);
/** The provenance chip text, such as `derived · classify.go`. */
function provenanceLabel(diagram) {
  const p = diagram.provenance;
  if (p.status === "inferred") return "inferred · sketched by Kankō";
  const names = [
    ...new Set(
      p.sources.map((s) =>
        s.path ? basename(s.path) : s.symbol || s.traceId || "",
      ),
    ),
  ].filter(Boolean);
  return `derived · ${names.join(", ") || p.method}`;
}
/** The expanded view chip, naming both revisions. */
function revisionLabel(diagram) {
  const { revs, status } = diagram.provenance;
  return `${status} · ${revs.before ? `${shortRev(revs.before)} vs ` : ""}${shortRev(revs.after)}`;
}
function edgeSignature(graph, nodeId) {
  return graph.edges
    .filter((e) => e.from === nodeId || e.to === nodeId)
    .map((e) => `${e.from}>${e.to}:${e.label || ""}`)
    .sort()
    .join("|");
}
/** Compare graphs by stable id. Matching fewer than 40% of the smaller graph's
 * nodes indicates a heavy refactor, where a diff would mislead. */
function diffGraphs(before, after) {
  const diff = { diffable: false, nodes: {}, edges: {} };
  for (const node of after.nodes) diff.nodes[node.id] = { status: "unchanged" };
  for (const edge of after.edges) diff.edges[edge.id] = { status: "unchanged" };
  if (!before) return diff;
  const old = new Map(before.nodes.map((n) => [n.id, n]));
  const matched = after.nodes.filter((n) => old.has(n.id)).length;
  const smaller = Math.min(before.nodes.length, after.nodes.length);
  if (!smaller || matched < Math.max(1, Math.ceil(smaller * 0.4))) return diff;
  diff.diffable = true;
  for (const node of after.nodes) {
    const previous = old.get(node.id);
    if (!previous) diff.nodes[node.id] = { status: "new" };
    else if (
      previous.label !== node.label ||
      (previous.sublabel || "") !== (node.sublabel || "") ||
      edgeSignature(before, node.id) !== edgeSignature(after, node.id) ||
      (previous.anchor &&
        node.anchor &&
        previous.anchor.contentHash !== node.anchor.contentHash)
    )
      diff.nodes[node.id] = {
        status: "changed",
        ...(previous.label !== node.label ? { was: previous.label } : {}),
      };
  }
  const present = new Set(after.nodes.map((n) => n.id));
  for (const node of before.nodes)
    if (!present.has(node.id)) diff.nodes[node.id] = { status: "removed" };
  const oldEdges = new Map(before.edges.map((e) => [e.id, e]));
  for (const edge of after.edges) {
    const previous = oldEdges.get(edge.id);
    if (!previous) diff.edges[edge.id] = { status: "new" };
    else if (
      previous.from !== edge.from ||
      previous.to !== edge.to ||
      (previous.label || "") !== (edge.label || "")
    )
      diff.edges[edge.id] = {
        status: "changed",
        ...((previous.label || "") !== (edge.label || "") && previous.label
          ? { was: previous.label }
          : {}),
      };
  }
  const edgeIds = new Set(after.edges.map((e) => e.id));
  for (const edge of before.edges)
    if (!edgeIds.has(edge.id)) diff.edges[edge.id] = { status: "removed" };
  return diff;
}
/** Nodes in reading order: breadth first from entry nodes, then the rest. */
function readingOrder(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Set(graph.edges.map((e) => e.to));
  const ordered = [];
  const seen = new Set();
  const edges = [...graph.edges].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const visit = (start) => {
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      ordered.push(node);
      for (const edge of edges)
        if (edge.from === node.id) {
          const next = byId.get(edge.to);
          if (next && !seen.has(next.id)) queue.push(next);
        }
    }
  };
  for (const node of graph.nodes)
    if (node.shape === "start" || !incoming.has(node.id)) visit(node);
  for (const node of graph.nodes) visit(node);
  return ordered;
}
function nodeTags(node, options) {
  const tags = [];
  const status = options.diff?.diffable ? options.diff.nodes[node.id] : null;
  if (status && status.status !== "unchanged")
    tags.push(
      status.status === "changed" && status.was
        ? `changed, was: ${status.was}`
        : status.status,
    );
  for (const id of node.claimIds || [])
    tags.push(`${id} ${options.claims?.[id] || "cited"}`);
  return tags.length ? ` [${tags.join("; ")}]` : "";
}
const formatTime = (value, unit) => `${value}${unit}`;
/** Ordered text lines for screen readers and copying. */
function describeGraph(kind, graph, options = {}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id) => byId.get(id)?.label || id;
  const lines = [];
  if (options.stale)
    lines.push("Stale: the code changed since this was drawn.");
  if (kind === "sequence") {
    const participants = graph.nodes.filter((n) => n.shape === "participant");
    if (participants.length)
      lines.push(
        `Participants: ${participants.map((n) => n.label + nodeTags(n, options)).join(", ")}.`,
      );
    [...graph.edges]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach((edge) =>
        lines.push(
          `${name(edge.from)} ${edge.kind === "return" ? "returns to" : "→"} ${name(edge.to)}${edge.label ? `: ${edge.label}` : ""}`,
        ),
      );
    return lines;
  }
  if (kind === "timeline" && graph.axis) {
    const axis = graph.axis;
    const lanes = new Map((graph.lanes || []).map((l) => [l.id, l.label]));
    lines.push(
      `Time axis from ${formatTime(axis.min, axis.unit)} to ${formatTime(axis.max, axis.unit)}.`,
    );
    const items = [
      ...graph.nodes
        .filter((n) => n.span)
        .map((n) => ({
          at: n.span?.start ?? 0,
          text: `${formatTime(n.span?.start ?? 0, axis.unit)}–${formatTime(n.span?.end ?? 0, axis.unit)}: ${n.label}${n.sublabel ? ` (${n.sublabel})` : ""}${n.span?.style === "ghost" ? ", does not run" : ""}${lanes.get(n.span?.lane || "") ? ` on ${lanes.get(n.span?.lane || "")}` : ""}${nodeTags(n, options)}`,
        })),
      ...(axis.marks || []).map((m) => ({
        at: m.at,
        text: `${formatTime(m.at, axis.unit)}: ${m.label}`,
      })),
    ].sort((a, b) => a.at - b.at);
    lines.push(...items.map((i) => i.text));
    return lines;
  }
  for (const node of readingOrder(graph)) {
    const outgoing = graph.edges
      .filter((e) => e.from === node.id)
      .map((e) => `${e.label ? `${e.label} → ` : "→ "}${name(e.to)}`);
    lines.push(
      `${node.label}${node.sublabel ? ` (${node.sublabel})` : ""}${nodeTags(node, options)}${outgoing.length ? `: ${outgoing.join("; ")}` : ""}`,
    );
  }
  return lines;
}
/** A one-line accessible summary of the graph. */
function ariaSummary(diagram, graph, stale = false) {
  const n = graph.nodes.length,
    e = graph.edges.length;
  return `${(0, exports.kindLabel)(diagram.kind)} diagram, ${diagram.title}: ${n} ${n === 1 ? "node" : "nodes"} and ${e} ${e === 1 ? "connection" : "connections"}. ${stale ? "Stale: code changed since drawn" : provenanceLabel(diagram)}.`;
}
/** Every anchor in a diagram, after graph first. */
function diagramAnchors(diagram) {
  return [diagram.after, diagram.before]
    .filter((g) => Boolean(g))
    .flatMap((g) => g.nodes.flatMap((n) => (n.anchor ? [n.anchor] : [])));
}
