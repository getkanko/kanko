import type { ContentHash, LineRange, Revisions, SourceSide } from "./types.js";

// Diagram data used by MCP and the extension. This module has no Node
// dependencies; validation and hashing live in diagram-validate.ts.

export type DiagramKind =
  "flow" | "sequence" | "state" | "dataflow" | "timeline";
export type DiagramProvenanceStatus = "derived" | "inferred";
export type DiagramMethod = "static-analysis" | "trace" | "agent-sketch";
export type DiagramOrigin = "auto" | "requested";
export type DiagramMode = "auto" | "onRequest" | "off";
export type DiagramOpenBeside = "ask" | "always" | "never";
export type NodeShape =
  | "start"
  | "decision"
  | "action"
  | "terminal"
  | "state"
  | "participant"
  | "span";
export type EdgeKind =
  "flow" | "call" | "return" | "transition" | "data" | "wait";
export type DiffStatus = "new" | "changed" | "removed" | "unchanged";

/** A source location in the review map's pinned revisions. */
export interface DiagramAnchor {
  path: string;
  side: SourceSide;
  /** Filled from the review map when omitted. */
  rev?: Revisions;
  context: LineRange;
  contentHash: ContentHash;
  symbol?: string;
}

export interface SourceRef {
  path?: string;
  symbol?: string;
  traceId?: string;
}

export interface Lane {
  id: string;
  label: string;
}

export interface AxisMark {
  at: number;
  label: string;
  kind?: "deadline" | "event";
}

export interface Axis {
  unit: "ms" | "s";
  min: number;
  max: number;
  marks?: AxisMark[];
}

export interface DiagramNode {
  /** Stable across before/after: derive it from the anchored construct. */
  id: string;
  label: string;
  sublabel?: string;
  shape: NodeShape;
  /** Required when provenance is derived. */
  anchor?: DiagramAnchor;
  beatIds?: string[];
  claimIds?: string[];
  span?: {
    lane: string;
    start: number;
    end: number;
    style?: "solid" | "ghost";
  };
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind?: EdgeKind;
  /** Message order in a sequence diagram. */
  order?: number;
  beatIds?: string[];
}

export interface Graph {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  lanes?: Lane[];
  axis?: Axis;
}

export interface DiagramProvenance {
  status: DiagramProvenanceStatus;
  method: DiagramMethod;
  sources: SourceRef[];
  revs: { before?: string; after: string };
}

export interface Diagram {
  id: string;
  kind: DiagramKind;
  title: string;
  stopId: string;
  origin: DiagramOrigin;
  /** One plain sentence about the change, shown under the card header. */
  reason: string;
  provenance: DiagramProvenance;
  before?: Graph;
  after: Graph;
  pinned: boolean;
  /** Hash of every anchored range, used to detect stale diagrams. */
  sourceHash: ContentHash;
  createdAt: string;
  /** The diagram this one redraws. */
  replaces?: string;
  /** The detour that requested this diagram. */
  detourId?: string;
}

/** What an agent submits; the service assigns identity and hashes. */
export type DiagramInput = Omit<
  Diagram,
  "id" | "pinned" | "sourceHash" | "createdAt"
> & { pinned?: boolean };

export interface DiagramSkip {
  stopId: string;
  reason: string;
  recordedAt: string;
}

export interface DiagramSettings {
  mode: DiagramMode;
  maxPerStop: number;
  derivedOnly: boolean;
  openBeside: DiagramOpenBeside;
}

export const DIAGRAM_KINDS: readonly DiagramKind[] = [
  "flow",
  "sequence",
  "state",
  "dataflow",
  "timeline",
];
export const NODE_SHAPES: readonly NodeShape[] = [
  "start",
  "decision",
  "action",
  "terminal",
  "state",
  "participant",
  "span",
];
export const EDGE_KINDS: readonly EdgeKind[] = [
  "flow",
  "call",
  "return",
  "transition",
  "data",
  "wait",
];
export const DIAGRAM_LIMITS = { card: 12, expanded: 40, beatNodes: 3 };
export const DEFAULT_DIAGRAM_SETTINGS: DiagramSettings = {
  mode: "auto",
  maxPerStop: 1,
  derivedOnly: false,
  openBeside: "ask",
};

const KIND_LABELS: Record<DiagramKind, string> = {
  flow: "Flow",
  sequence: "Sequence",
  state: "State machine",
  dataflow: "Data flow",
  timeline: "Timeline",
};
export const kindLabel = (kind: DiagramKind) => KIND_LABELS[kind];

export function readDiagramSettings(value: unknown): DiagramSettings {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const max = input.maxPerStop;
  return {
    mode:
      input.mode === "auto" ||
      input.mode === "onRequest" ||
      input.mode === "off"
        ? input.mode
        : DEFAULT_DIAGRAM_SETTINGS.mode,
    maxPerStop:
      typeof max === "number" && Number.isInteger(max) && max >= 0 && max <= 3
        ? max
        : DEFAULT_DIAGRAM_SETTINGS.maxPerStop,
    derivedOnly: input.derivedOnly === true,
    openBeside:
      input.openBeside === "always" || input.openBeside === "never"
        ? input.openBeside
        : "ask",
  };
}

const shortRev = (rev: string) =>
  rev.startsWith("WORKTREE:") ? "working snapshot" : rev.slice(0, 7);
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The provenance chip text, such as `derived · classify.go`. */
export function provenanceLabel(diagram: Pick<Diagram, "provenance">): string {
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
export function revisionLabel(diagram: Pick<Diagram, "provenance">): string {
  const { revs, status } = diagram.provenance;
  return `${status} · ${revs.before ? `${shortRev(revs.before)} vs ` : ""}${shortRev(revs.after)}`;
}

export { shortRev };

export interface GraphDiff {
  /** False when ids cannot be matched reliably; show After only. */
  diffable: boolean;
  nodes: Record<string, { status: DiffStatus; was?: string }>;
  edges: Record<string, { status: DiffStatus; was?: string }>;
}

function edgeSignature(graph: Graph, nodeId: string) {
  return graph.edges
    .filter((e) => e.from === nodeId || e.to === nodeId)
    .map((e) => `${e.from}>${e.to}:${e.label || ""}`)
    .sort()
    .join("|");
}

/** Compare graphs by stable id. Matching fewer than 40% of the smaller graph's
 * nodes indicates a heavy refactor, where a diff would mislead. */
export function diffGraphs(before: Graph | undefined, after: Graph): GraphDiff {
  const diff: GraphDiff = { diffable: false, nodes: {}, edges: {} };
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
export function readingOrder(graph: Graph): DiagramNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Set(graph.edges.map((e) => e.to));
  const ordered: DiagramNode[] = [];
  const seen = new Set<string>();
  const edges = [...graph.edges].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const visit = (start: DiagramNode) => {
    const queue = [start];
    while (queue.length) {
      const node = queue.shift() as DiagramNode;
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

export interface DescribeOptions {
  diff?: GraphDiff;
  /** Claim truth status by claim id, rendered as text. */
  claims?: Record<string, string>;
  stale?: boolean;
}

function nodeTags(node: DiagramNode, options: DescribeOptions) {
  const tags: string[] = [];
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

const formatTime = (value: number, unit: Axis["unit"]) => `${value}${unit}`;

/** Ordered text lines for screen readers and copying. */
export function describeGraph(
  kind: DiagramKind,
  graph: Graph,
  options: DescribeOptions = {},
): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.label || id;
  const lines: string[] = [];
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
export function ariaSummary(
  diagram: Pick<Diagram, "kind" | "title" | "provenance">,
  graph: Graph,
  stale = false,
): string {
  const n = graph.nodes.length,
    e = graph.edges.length;
  return `${kindLabel(diagram.kind)} diagram, ${diagram.title}: ${n} ${n === 1 ? "node" : "nodes"} and ${e} ${e === 1 ? "connection" : "connections"}. ${stale ? "Stale: code changed since drawn" : provenanceLabel(diagram)}.`;
}

/** Every anchor in a diagram, after graph first. */
export function diagramAnchors(
  diagram: Pick<Diagram, "before" | "after">,
): DiagramAnchor[] {
  return [diagram.after, diagram.before]
    .filter((g): g is Graph => Boolean(g))
    .flatMap((g) => g.nodes.flatMap((n) => (n.anchor ? [n.anchor] : [])));
}
