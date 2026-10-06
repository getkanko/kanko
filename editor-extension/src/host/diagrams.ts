import type {
  Diagram,
  DiagramNode,
  DiagramSettings,
  DiagramSkip,
  Graph,
} from "../../../generated/shared/diagram.js";
import type { TourPlan, TourStop } from "../shared/tour.js";
import type { ClaimSummary } from "../../../generated/shared/types.js";
import type { AnchorPresentation } from "../shared/snapshot.js";
import type {
  DetourView,
  DiagramSnapshot,
  DiagramView,
  NodeFacts,
  TourMapEntry,
} from "../shared/diagram-view.js";
import { isRecord } from "./requests.js";
import {
  DEFAULT_DIAGRAM_SETTINGS,
  ariaSummary,
  describeGraph,
  kindLabel,
  provenanceLabel,
  revisionLabel,
  shortRev,
} from "../../../generated/shared/diagram.js";
import { validateDiagram } from "../../../generated/shared/diagram-validate.js";
import { layoutDiagram } from "./diagram-layout.js";

// Diagram state for one loaded tour. Every function returns a new state so a
// failed update leaves the published tour untouched.

export interface DiagramRecord extends Diagram {
  stale: boolean;
  feedback?: "not_helpful";
}

export interface Detour {
  id: string;
  stopId: string;
  question?: string;
  answer?: string;
  status?: string;
  final: boolean;
  diagramId?: string;
  pinned: boolean;
}

export interface DiagramState {
  settings: DiagramSettings;
  records: Record<string, DiagramRecord>;
  /** Views by record id, plus `draft:<detourId>` while a detour streams. */
  views: Record<string, DiagramView>;
  skips: Record<string, DiagramSkip>;
  /** Stops whose diagram the reviewer marked not helpful. */
  collapsed: string[];
  /** Open diagram requests by stop id. */
  pending: Record<string, string>;
  detours: Record<string, Detour>;
  activeDetour: string | null;
  claims: Record<string, string>;
}

const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const ATTENTION = /disput|contradict|needs-change|refuted|unsupported/i;

export function emptyDiagramState(
  settings: DiagramSettings = DEFAULT_DIAGRAM_SETTINGS,
): DiagramState {
  return {
    settings,
    records: {},
    views: {},
    skips: {},
    collapsed: [],
    pending: {},
    detours: {},
    activeDetour: null,
    claims: {},
  };
}

function claimStatus(claim: ClaimSummary) {
  return claim.disposition && claim.disposition !== "unexamined"
    ? claim.disposition
    : claim.truthStatus || claim.status || claim.disposition || "cited";
}

/** Lay out a diagram and attach beats, code locations and claim status. */
export async function buildView(
  diagram: Pick<
    Diagram,
    | "id"
    | "kind"
    | "title"
    | "stopId"
    | "origin"
    | "reason"
    | "provenance"
    | "before"
    | "after"
    | "pinned"
  >,
  options: {
    stale?: boolean;
    streaming?: boolean;
    claims?: Record<string, string>;
    notHelpful?: boolean;
  } = {},
): Promise<DiagramView> {
  const { geometry, union } = await layoutDiagram(diagram, {
    streaming: options.streaming,
  });
  const source = new Map(union.nodes.map((n) => [n.id, n]));
  const edgeSource = new Map(union.edges.map((e) => [e.id, e]));
  const claims = options.claims || {};
  const symbol = diagram.provenance.sources.find((s) => s.symbol)?.symbol;
  const facts = (node?: DiagramNode): NodeFacts => {
    const anchor = node?.anchor;
    return {
      label: node?.label || "",
      ...(node?.sublabel ? { sublabel: node.sublabel } : {}),
      ...(anchor
        ? {
            location: `${anchor.path}:${anchor.context.startLine}${anchor.context.endLine === anchor.context.startLine ? "" : `–${anchor.context.endLine}`}${anchor.side === "base" ? " (base)" : ""}`,
          }
        : {}),
      beatIds: node?.beatIds || [],
      claims: (node?.claimIds || []).map((id) => ({
        id,
        status: claims[id] || "cited",
        attention: ATTENTION.test(claims[id] || ""),
      })),
    };
  };
  const stale = options.stale === true;
  return {
    id: diagram.id,
    kind: diagram.kind,
    title: diagram.title,
    tabTitle: `${kindLabel(diagram.kind)} · ${symbol || diagram.title}`,
    stopId: diagram.stopId,
    origin: diagram.origin,
    reason: diagram.reason,
    status: diagram.provenance.status,
    chip: options.streaming
      ? "drawing…"
      : stale
        ? "stale · code changed since drawn"
        : provenanceLabel(diagram),
    revisionChip: revisionLabel(diagram),
    pinned: diagram.pinned,
    stale,
    streaming: options.streaming === true,
    notHelpful: options.notHelpful === true,
    hasBefore: Boolean(diagram.before?.nodes.length),
    diffable: union.diff.diffable,
    nodeCount: diagram.after.nodes.length,
    layout: {
      width: geometry.width,
      height: geometry.height,
      lanes: geometry.lanes,
      ...(geometry.axis ? { axis: geometry.axis } : {}),
      nodes: geometry.nodes.map((n) => {
        const node = source.get(n.id);
        return {
          ...n,
          ...facts(node),
          ...(node?.before ? { before: facts(node.before) } : {}),
        };
      }),
      edges: geometry.edges.map((e) => ({
        ...e,
        beatIds: edgeSource.get(e.id)?.beatIds || [],
      })),
    },
    aria: ariaSummary(diagram, diagram.after, stale),
    description: {
      after: describeGraph(diagram.kind, diagram.after, {
        diff: union.diff,
        claims,
        stale,
      }),
      ...(diagram.before?.nodes.length
        ? { before: describeGraph(diagram.kind, diagram.before, { claims }) }
        : {}),
    },
  };
}

/** Check a stored diagram's shape before it reaches layout. The MCP server
 * already validated sources; this guards the HTTP boundary. */
function readRecord(value: unknown, plan: TourPlan): DiagramRecord {
  const checked = validateDiagram(value, { stops: plan.stops });
  if (
    !checked.ok ||
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sourceHash !== "string" ||
    typeof value.createdAt !== "string"
  )
    throw Object.assign(fail("bad_request", "The diagram is malformed."), {
      details: { findings: checked.findings },
    });
  return {
    ...(checked.diagram as Diagram),
    id: value.id,
    sourceHash: value.sourceHash as Diagram["sourceHash"],
    createdAt: value.createdAt,
    pinned: value.pinned === true,
    stale: value.stale === true,
    ...(value.feedback === "not_helpful"
      ? { feedback: "not_helpful" as const }
      : {}),
  };
}

function readSkip(value: unknown, plan: TourPlan): DiagramSkip {
  if (
    !isRecord(value) ||
    typeof value.stopId !== "string" ||
    !plan.stops.some((s) => s.id === value.stopId) ||
    typeof value.reason !== "string" ||
    typeof value.recordedAt !== "string"
  )
    throw fail("bad_request", "The diagram skip is malformed.");
  return {
    stopId: value.stopId,
    reason: value.reason,
    recordedAt: value.recordedAt,
  };
}

async function withView(
  state: DiagramState,
  record: DiagramRecord,
): Promise<DiagramState> {
  const view = await buildView(record, {
    stale: record.stale,
    claims: state.claims,
    notHelpful: record.feedback === "not_helpful",
  });
  return {
    ...state,
    records: { ...state.records, [record.id]: record },
    views: { ...state.views, [record.id]: view },
  };
}

export async function prepareDiagrams(
  body: unknown,
  plan: TourPlan,
  settings: DiagramSettings,
): Promise<DiagramState> {
  let state = emptyDiagramState(settings);
  const input = isRecord(body) && isRecord(body.diagrams) ? body.diagrams : {};
  const claims =
    isRecord(body) && Array.isArray(body.claims) ? body.claims : [];
  state.claims = Object.fromEntries(
    claims
      .filter((c): c is ClaimSummary => isRecord(c) && typeof c.id === "string")
      .map((c) => [c.id, claimStatus(c)]),
  );
  for (const value of Array.isArray(input.skips) ? input.skips : []) {
    const skip = readSkip(value, plan);
    state.skips = { ...state.skips, [skip.stopId]: skip };
  }
  for (const value of Array.isArray(input.items) ? input.items : []) {
    // A drawing that no longer fits this plan must not block the tour.
    let record: DiagramRecord;
    try {
      record = readRecord(value, plan);
    } catch {
      continue;
    }
    state = await withView(state, record);
    if (
      record.feedback === "not_helpful" &&
      !state.collapsed.includes(record.stopId)
    )
      state.collapsed = [...state.collapsed, record.stopId];
  }
  return state;
}

/** Diagrams shown on a stop: automatic ones and pinned requests. */
export function stopRecords(state: DiagramState, stopId: string) {
  return Object.values(state.records)
    .filter((r) => r.stopId === stopId && (r.origin === "auto" || r.pinned))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function resolveDetour(
  state: DiagramState,
  record: DiagramRecord,
  detourId?: string,
) {
  const id =
    detourId ||
    record.detourId ||
    Object.entries(state.detours).find(
      ([, d]) => !d.final && d.stopId === record.stopId,
    )?.[0] ||
    // An unrequested, unpinned drawing has no stop card, so it gets a detour.
    (record.pinned ? undefined : record.id);
  const pending = { ...state.pending };
  if (pending[record.stopId] && (!id || pending[record.stopId] === id))
    delete pending[record.stopId];
  if (!id) return { ...state, pending };
  const detour: Detour = {
    ...(state.detours[id] || { id, stopId: record.stopId, pinned: false }),
    final: true,
    diagramId: record.id,
    pinned: record.pinned,
  };
  const views = { ...state.views };
  delete views[`draft:${id}`];
  return {
    ...state,
    pending,
    views,
    detours: { ...state.detours, [id]: detour },
    activeDetour: id,
  };
}

export async function putDiagram(
  state: DiagramState,
  plan: TourPlan,
  value: unknown,
): Promise<DiagramState> {
  const record = readRecord(value, plan);
  let next = state;
  if (record.replaces && next.records[record.replaces]) {
    const records = { ...next.records },
      views = { ...next.views };
    delete records[record.replaces];
    delete views[record.replaces];
    next = { ...next, records, views };
  }
  next = await withView(next, record);
  if (record.origin === "auto") {
    const skips = { ...next.skips };
    delete skips[record.stopId];
    next = {
      ...next,
      skips,
      collapsed: next.collapsed.filter((id) => id !== record.stopId),
    };
  }
  return record.origin === "requested" ? resolveDetour(next, record) : next;
}

export function skipDiagram(
  state: DiagramState,
  plan: TourPlan,
  value: unknown,
): DiagramState {
  const skip = readSkip(value, plan);
  return { ...state, skips: { ...state.skips, [skip.stopId]: skip } };
}

export async function pinDiagram(
  state: DiagramState,
  plan: TourPlan,
  diagramId: unknown,
  stopId: unknown,
): Promise<DiagramState> {
  const record =
    typeof diagramId === "string" ? state.records[diagramId] : undefined;
  if (!record) throw fail("bad_request", "Unknown diagram.");
  if (typeof stopId !== "string" || !plan.stops.some((s) => s.id === stopId))
    throw fail("bad_request", "Pin the diagram to a stop of this tour.");
  const moved = record.stopId !== stopId;
  const strip = (graph?: Graph) =>
    graph && {
      ...graph,
      nodes: graph.nodes.map(({ beatIds: _, ...n }) => n),
      edges: graph.edges.map(({ beatIds: _, ...e }) => e),
    };
  const pinned: DiagramRecord = {
    ...record,
    pinned: true,
    stopId,
    ...(moved
      ? { after: strip(record.after) as Graph, before: strip(record.before) }
      : {}),
  };
  const next = await withView(state, pinned);
  const detours = Object.fromEntries(
    Object.entries(next.detours).map(([id, d]) => [
      id,
      d.diagramId === pinned.id ? { ...d, pinned: true } : d,
    ]),
  );
  return { ...next, detours };
}

export interface StreamMessage {
  detourId: string;
  diagramId: string;
  draft?: unknown;
  diagram?: unknown;
  status?: string;
  question?: string;
  answer?: string;
  final: boolean;
}

export function readStream(body: Record<string, unknown>): StreamMessage {
  if (
    typeof body.detourId !== "string" ||
    !body.detourId ||
    typeof body.diagramId !== "string" ||
    typeof body.final !== "boolean"
  )
    throw fail("bad_request", "A stream needs detourId, diagramId, and final.");
  const text = (key: string) =>
    typeof body[key] === "string"
      ? { [key]: String(body[key]).slice(0, 4000) }
      : {};
  return {
    detourId: body.detourId,
    diagramId: body.diagramId,
    final: body.final,
    draft: body.draft,
    diagram: body.diagram,
    ...text("status"),
    ...text("question"),
    ...text("answer"),
  };
}

/** Partial drafts render with placeholders and a drawing… chip. */
export async function streamDiagram(
  state: DiagramState,
  plan: TourPlan,
  currentStop: string,
  message: StreamMessage,
): Promise<DiagramState> {
  const previous = state.detours[message.detourId];
  const draft = isRecord(message.draft) ? message.draft : {};
  const stopId =
    typeof draft.stopId === "string" &&
    plan.stops.some((s) => s.id === draft.stopId)
      ? draft.stopId
      : previous?.stopId || currentStop;
  const detour: Detour = {
    ...previous,
    pinned: previous?.pinned ?? false,
    id: message.detourId,
    stopId,
    ...(message.question ? { question: message.question } : {}),
    ...(message.answer ? { answer: message.answer } : {}),
    ...(message.status !== undefined ? { status: message.status } : {}),
    final: false,
  };
  let next: DiagramState = {
    ...state,
    detours: { ...state.detours, [detour.id]: detour },
    activeDetour: detour.id,
    pending: { ...state.pending, [stopId]: state.pending[stopId] || detour.id },
  };
  if (message.final) {
    const record = readRecord(message.diagram, plan);
    next = await withView(next, record);
    next = resolveDetour(next, record, detour.id);
    const done = next.detours[detour.id];
    return {
      ...next,
      detours: { ...next.detours, [detour.id]: { ...done, status: undefined } },
    };
  }
  const checked = validateDiagram({ ...draft, stopId }, { partial: true });
  if (!checked.ok)
    throw Object.assign(
      fail("bad_request", "The streamed draft is malformed."),
      {
        details: { findings: checked.findings },
      },
    );
  const partial = checked.diagram;
  const view = await buildView(
    {
      id: message.diagramId,
      kind: partial.kind,
      title: partial.title,
      stopId,
      origin: "requested",
      reason: typeof partial.reason === "string" ? partial.reason : "",
      provenance: isRecord(partial.provenance)
        ? partial.provenance
        : {
            status: "inferred",
            method: "agent-sketch",
            sources: [],
            revs: { after: "" },
          },
      after: partial.after,
      ...(partial.before ? { before: partial.before } : {}),
      pinned: false,
    },
    { streaming: true, claims: state.claims },
  );
  return {
    ...next,
    views: { ...next.views, [`draft:${detour.id}`]: view },
  };
}

export function requestDiagram(
  state: DiagramState,
  stopId: string,
  requestId: string,
  replaces?: string,
): DiagramState {
  return {
    ...state,
    pending: { ...state.pending, [stopId]: requestId },
    detours: {
      ...state.detours,
      [requestId]: {
        id: requestId,
        stopId,
        question: replaces
          ? "Redraw this diagram at the current revision."
          : "Draw a diagram for this stop.",
        status: "Waiting for Kankō to draw…",
        final: false,
        pinned: false,
      },
    },
    activeDetour: requestId,
  };
}

export function markNotHelpful(
  state: DiagramState,
  diagramId: string,
): DiagramState {
  const record = state.records[diagramId];
  if (!record) throw fail("bad_request", "Unknown diagram.");
  return {
    ...state,
    records: {
      ...state.records,
      [diagramId]: { ...record, feedback: "not_helpful" },
    },
    views: state.views[diagramId]
      ? {
          ...state.views,
          [diagramId]: { ...state.views[diagramId], notHelpful: true },
        }
      : state.views,
    collapsed: state.collapsed.includes(record.stopId)
      ? state.collapsed
      : [...state.collapsed, record.stopId],
  };
}

export function expandStop(state: DiagramState, stopId: string): DiagramState {
  return { ...state, collapsed: state.collapsed.filter((id) => id !== stopId) };
}

export function returnToTour(state: DiagramState): DiagramState {
  return { ...state, activeDetour: null };
}

/** Short stop ids such as `K03` read well in buttons; others use a position. */
const stopLabel = (plan: TourPlan, index: number) => {
  const id = plan.stops[index]?.id || "";
  return id && id.length <= 12 && !/\s/.test(id) ? id : `Stop ${index + 1}`;
};

function staleOverlay(view: DiagramView, drifted: boolean): DiagramView {
  if (view.stale || !drifted || view.streaming) return view;
  return {
    ...view,
    stale: true,
    chip: "stale · code changed since drawn",
    aria: view.aria.replace(/[^.]*\.$/, " Stale: code changed since drawn."),
    description: {
      ...view.description,
      after: [
        "Stale: the code changed since this was drawn.",
        ...view.description.after,
      ],
    },
  };
}

/** The part of the tour snapshot that describes diagrams. */
export function diagramSnapshot(
  state: DiagramState,
  plan: TourPlan,
  stop: TourStop,
  presentation: AnchorPresentation[] = [],
): DiagramSnapshot {
  // A working-tree edit to an anchored file makes the drawing stale too.
  const drifted = new Set(
    presentation.filter((a) => a.status === "stale").map((a) => a.path),
  );
  const isDrifted = (id: string) => {
    const record = state.records[id];
    return Boolean(
      record &&
      [record.after, record.before].some((g) =>
        g?.nodes.some((n) => n.anchor && drifted.has(n.anchor.path)),
      ),
    );
  };
  const view = (id: string) =>
    state.views[id] && staleOverlay(state.views[id], isDrifted(id));
  const off = state.settings.mode === "off";
  const cards = off
    ? []
    : stopRecords(state, stop.id).flatMap((r) =>
        state.views[r.id] ? [view(r.id)] : [],
      );
  const index = (id: string) => plan.stops.findIndex((s) => s.id === id);
  const active = state.activeDetour
    ? state.detours[state.activeDetour]
    : undefined;
  const detour: DetourView | undefined =
    active && !off
      ? {
          id: active.id,
          stopId: active.stopId,
          stopTitle: plan.stops[index(active.stopId)]?.title || active.stopId,
          stopLabel: stopLabel(plan, index(active.stopId)),
          ...(active.question ? { question: active.question } : {}),
          ...(active.answer ? { answer: active.answer } : {}),
          ...(active.status ? { status: active.status } : {}),
          final: active.final,
          pinned: active.pinned,
          ...((active.diagramId && state.views[active.diagramId]) ||
          state.views[`draft:${active.id}`]
            ? {
                diagram:
                  (active.diagramId && view(active.diagramId)) ||
                  state.views[`draft:${active.id}`],
              }
            : {}),
        }
      : undefined;
  const tourMap: TourMapEntry[] = off
    ? []
    : plan.stops.map((s, i) => {
        const records = stopRecords(state, s.id);
        const skip = state.skips[s.id];
        const state_: TourMapEntry["state"] = state.pending[s.id]
          ? "pending"
          : records.some((r) => r.origin === "auto")
            ? "auto"
            : records.length
              ? "requested"
              : skip
                ? "skipped"
                : "none";
        const first = records[0];
        return {
          stopId: s.id,
          title: s.title,
          label: stopLabel(plan, i),
          state: state_,
          ...(state_ === "skipped"
            ? { reason: skip.reason }
            : first
              ? { reason: first.reason }
              : {}),
          current: s.id === stop.id,
          firstBeatId: s.beats[0].id,
        };
      });
  const head = stop.anchors[0]?.rev.head || "";
  return {
    settings: state.settings,
    cards,
    collapsed: state.collapsed.includes(stop.id),
    ...(state.skips[stop.id] && !off ? { skip: state.skips[stop.id] } : {}),
    pending: Boolean(state.pending[stop.id]),
    ...(detour ? { detour } : {}),
    tourMap,
    redrawAt: shortRev(head),
  };
}

/** The stop anchor that shows a node's lines, preferring an exact overlap. */
export function anchorForNode(
  stop: TourStop,
  anchor: {
    path: string;
    side: "base" | "head";
    context: { startLine: number; endLine: number };
  },
): number | null {
  const overlaps = stop.anchors.find(
    (a) =>
      a.path === anchor.path &&
      [{ side: a.side, range: a.context }, ...a.focus].some(
        (span) =>
          span.side === anchor.side &&
          span.range.startLine <= anchor.context.endLine &&
          anchor.context.startLine <= span.range.endLine,
      ),
  );
  if (overlaps) return overlaps.n;
  // A diff view shows both sides, so the same file is the next best pointer.
  return stop.anchors.find((a) => a.path === anchor.path)?.n ?? null;
}
