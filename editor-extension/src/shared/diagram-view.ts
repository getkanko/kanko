// Laid-out diagrams sent to the Tour view and the expanded diagram panel. The
// host does layout and diffing so both webviews only draw.
import type {
  DiagramKind,
  DiagramOrigin,
  DiagramProvenanceStatus,
  DiagramSettings,
  DiagramSkip,
  DiffStatus,
  EdgeKind,
  NodeShape,
} from "../../../generated/shared/diagram.js";

export type { DiagramKind, DiagramSettings, DiffStatus, EdgeKind, NodeShape };

export type GraphSide = "before" | "after";

export interface Point {
  x: number;
  y: number;
}

export interface PositionedNode {
  id: string;
  label: string;
  sublabel?: string;
  shape: NodeShape;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Relative to the before graph; `unchanged` when there is no diff. */
  status: DiffStatus;
  was?: string;
  /** Graphs that contain this node. */
  sides: GraphSide[];
  /** `path:start-end` on its side, when anchored. */
  location?: string;
  beatIds: string[];
  claims: { id: string; status: string; attention: boolean }[];
  /** A streamed edge names this node before it arrives. */
  placeholder?: boolean;
  ghost?: boolean;
}

export interface PositionedEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind?: EdgeKind;
  points: Point[];
  labelAt?: Point;
  status: DiffStatus;
  was?: string;
  sides: GraphSide[];
  beatIds: string[];
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Sequence participants and timeline lanes. */
  lanes: {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  axis?: {
    y: number;
    x0: number;
    x1: number;
    ticks: { label: string; x: number }[];
    marks: { label: string; x: number; kind: "deadline" | "event" }[];
  };
}

export interface DiagramView {
  id: string;
  kind: DiagramKind;
  title: string;
  /** Short editor tab title, such as `Flow · Decide`. */
  tabTitle: string;
  stopId: string;
  origin: DiagramOrigin;
  reason: string;
  status: DiagramProvenanceStatus;
  /** `derived · classify.go`, or the stale or drawing label. */
  chip: string;
  /** Both revisions, for the expanded view. */
  revisionChip: string;
  pinned: boolean;
  stale: boolean;
  streaming: boolean;
  notHelpful: boolean;
  layout: DiagramLayout;
  diffable: boolean;
  hasBefore: boolean;
  nodeCount: number;
  aria: string;
  description: { after: string[]; before?: string[] };
}

export interface DetourView {
  id: string;
  stopId: string;
  stopTitle: string;
  stopLabel: string;
  question?: string;
  answer?: string;
  status?: string;
  final: boolean;
  diagram?: DiagramView;
  pinned: boolean;
}

export type StopDiagramState =
  "auto" | "requested" | "skipped" | "pending" | "none";

export interface TourMapEntry {
  stopId: string;
  title: string;
  label: string;
  state: StopDiagramState;
  reason?: string;
  current: boolean;
  firstBeatId: string;
}

export interface DiagramSnapshot {
  settings: DiagramSettings;
  /** Diagrams on the current stop, oldest first. */
  cards: DiagramView[];
  /** Reviewer marked this stop's diagram not helpful. */
  collapsed: boolean;
  skip?: DiagramSkip;
  pending: boolean;
  detour?: DetourView;
  tourMap: TourMapEntry[];
  /** The revision a redraw would use, for `Redraw at <sha>`. */
  redrawAt: string;
}
