// Generated from TypeScript. Run npm run runtime:build in editor-extension.
import type { ContentHash, LineRange, Revisions, SourceSide } from "./types.js";
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
  revs: {
    before?: string;
    after: string;
  };
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
> & {
  pinned?: boolean;
};
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
export declare const DIAGRAM_KINDS: readonly DiagramKind[];
export declare const NODE_SHAPES: readonly NodeShape[];
export declare const EDGE_KINDS: readonly EdgeKind[];
export declare const DIAGRAM_LIMITS: {
  card: number;
  expanded: number;
  beatNodes: number;
};
export declare const DEFAULT_DIAGRAM_SETTINGS: DiagramSettings;
export declare const kindLabel: (kind: DiagramKind) => string;
export declare function readDiagramSettings(value: unknown): DiagramSettings;
declare const shortRev: (rev: string) => string;
/** The provenance chip text, such as `derived · classify.go`. */
export declare function provenanceLabel(
  diagram: Pick<Diagram, "provenance">,
): string;
/** The expanded view chip, naming both revisions. */
export declare function revisionLabel(
  diagram: Pick<Diagram, "provenance">,
): string;
export { shortRev };
export interface GraphDiff {
  /** False when ids cannot be matched reliably; show After only. */
  diffable: boolean;
  nodes: Record<
    string,
    {
      status: DiffStatus;
      was?: string;
    }
  >;
  edges: Record<
    string,
    {
      status: DiffStatus;
      was?: string;
    }
  >;
}
/** Compare graphs by stable id. Matching fewer than 40% of the smaller graph's
 * nodes indicates a heavy refactor, where a diff would mislead. */
export declare function diffGraphs(
  before: Graph | undefined,
  after: Graph,
): GraphDiff;
/** Nodes in reading order: breadth first from entry nodes, then the rest. */
export declare function readingOrder(graph: Graph): DiagramNode[];
export interface DescribeOptions {
  diff?: GraphDiff;
  /** Claim truth status by claim id, rendered as text. */
  claims?: Record<string, string>;
  stale?: boolean;
}
/** Ordered text lines for screen readers and copying. */
export declare function describeGraph(
  kind: DiagramKind,
  graph: Graph,
  options?: DescribeOptions,
): string[];
/** A one-line accessible summary of the graph. */
export declare function ariaSummary(
  diagram: Pick<Diagram, "kind" | "title" | "provenance">,
  graph: Graph,
  stale?: boolean,
): string;
/** Every anchor in a diagram, after graph first. */
export declare function diagramAnchors(
  diagram: Pick<Diagram, "before" | "after">,
): DiagramAnchor[];
