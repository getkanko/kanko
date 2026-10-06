import type {
  Diagram,
  DiagramEdge,
  DiagramNode,
  Graph,
  GraphDiff,
} from "../../../generated/shared/diagram.js";
import type {
  DiagramLayout,
  GraphSide,
  PositionedEdge,
  PositionedNode,
} from "../shared/diagram-view.js";
import { diffGraphs } from "../../../generated/shared/diagram.js";

// Lay out the union of the before and after graphs once, so switching between
// Before, After and Diff never moves a node. ELK's layered algorithm handles
// flow, state and dataflow; sequence and timeline use fixed lanes and axes.

type Item<T> = T & {
  status: PositionedNode["status"];
  was?: string;
  sides: GraphSide[];
};
export interface UnionGraph {
  nodes: Item<DiagramNode & { placeholder?: boolean }>[];
  edges: Item<DiagramEdge>[];
  diff: GraphDiff;
}

// elkjs's declarations need DOM worker types; describe the one call we use.
const ELK: new () => {
  layout(graph: object): Promise<unknown>;
} = require("elkjs/lib/elk.bundled.js");
const elk = new ELK();
const FONT = 7.1;

export function nodeSize(
  node: Pick<DiagramNode, "label" | "sublabel" | "shape">,
) {
  const text = Math.max(
    node.label.length * FONT,
    (node.sublabel?.length || 0) * FONT * 0.86,
  );
  const width = Math.round(Math.min(300, Math.max(92, text + 36)));
  const height = node.shape === "decision" ? 46 : node.sublabel ? 50 : 38;
  return { width, height };
}

/** After nodes and edges plus removed before items, with placeholders for
 * streamed edges whose endpoints have not arrived. */
export function unionGraph(
  diagram: Pick<Diagram, "before" | "after">,
  { streaming = false } = {},
): UnionGraph {
  const diff = diffGraphs(diagram.before, diagram.after);
  const beforeNodes = new Set(diagram.before?.nodes.map((n) => n.id));
  const beforeEdges = new Set(diagram.before?.edges.map((e) => e.id));
  const sides = (ids: Set<string>, id: string, inAfter: boolean) =>
    [
      ...(diagram.before && ids.has(id) ? (["before"] as const) : []),
      ...(inAfter ? (["after"] as const) : []),
    ] as GraphSide[];
  const nodes: UnionGraph["nodes"] = diagram.after.nodes.map((n) => ({
    ...n,
    ...(diff.diffable ? diff.nodes[n.id] : { status: "unchanged" as const }),
    sides: sides(beforeNodes, n.id, true),
  }));
  const edges: UnionGraph["edges"] = diagram.after.edges.map((e) => ({
    ...e,
    ...(diff.diffable ? diff.edges[e.id] : { status: "unchanged" as const }),
    sides: sides(beforeEdges, e.id, true),
  }));
  if (diff.diffable && diagram.before) {
    for (const node of diagram.before.nodes)
      if (diff.nodes[node.id]?.status === "removed")
        nodes.push({ ...node, status: "removed", sides: ["before"] });
    for (const edge of diagram.before.edges)
      if (diff.edges[edge.id]?.status === "removed")
        edges.push({ ...edge, status: "removed", sides: ["before"] });
  }
  const known = new Set(nodes.map((n) => n.id));
  if (streaming)
    for (const edge of edges)
      for (const id of [edge.from, edge.to])
        if (!known.has(id)) {
          known.add(id);
          nodes.push({
            id,
            label: "…",
            shape: "action",
            placeholder: true,
            status: "unchanged",
            sides: ["after"],
          });
        }
  return {
    nodes,
    edges: edges.filter((e) => known.has(e.from) && known.has(e.to)),
    diff,
  };
}

type Positioned = Omit<PositionedNode, "location" | "beatIds" | "claims">;
type PositionedLink = Omit<PositionedEdge, "beatIds">;
interface Geometry {
  width: number;
  height: number;
  nodes: Positioned[];
  edges: PositionedLink[];
  lanes: DiagramLayout["lanes"];
  axis?: DiagramLayout["axis"];
}

const round = (value: number) => Math.round(value * 10) / 10;
const base = (n: UnionGraph["nodes"][number]) => ({
  id: n.id,
  label: n.label,
  ...(n.sublabel ? { sublabel: n.sublabel } : {}),
  shape: n.shape,
  status: n.status,
  ...(n.was ? { was: n.was } : {}),
  sides: n.sides,
  ...(n.placeholder ? { placeholder: true } : {}),
});
const link = (
  e: UnionGraph["edges"][number],
  points: PositionedEdge["points"],
) => ({
  id: e.id,
  from: e.from,
  to: e.to,
  ...(e.label ? { label: e.label } : {}),
  ...(e.kind ? { kind: e.kind } : {}),
  status: e.status,
  ...(e.was ? { was: e.was } : {}),
  sides: e.sides,
  points: points.map((p) => ({ x: round(p.x), y: round(p.y) })),
});

interface ElkPoint {
  x: number;
  y: number;
}
interface ElkResult {
  width?: number;
  height?: number;
  children?: {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }[];
  edges?: {
    id: string;
    sections?: {
      startPoint: ElkPoint;
      endPoint: ElkPoint;
      bendPoints?: ElkPoint[];
    }[];
    labels?: { x?: number; y?: number; width?: number; height?: number }[];
  }[];
}

async function layered(
  graph: UnionGraph,
  direction: "DOWN" | "RIGHT",
): Promise<Geometry> {
  const result = (await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "34",
      "elk.layered.spacing.edgeNodeBetweenLayers": "14",
      "elk.spacing.edgeLabel": "4",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.edgeLabels.inline": "false",
      "elk.padding": "[top=12,left=12,bottom=12,right=12]",
      "elk.randomSeed": "1",
    },
    children: graph.nodes.map((n) => ({ id: n.id, ...nodeSize(n) })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      sources: [e.from],
      targets: [e.to],
      ...(e.label
        ? {
            labels: [
              { text: e.label, width: e.label.length * 6.4 + 6, height: 14 },
            ],
          }
        : {}),
    })),
  })) as ElkResult;
  const placed = new Map((result.children || []).map((c) => [c.id, c]));
  const routes = new Map((result.edges || []).map((e) => [e.id, e]));
  return {
    width: Math.ceil(result.width || 0),
    height: Math.ceil(result.height || 0),
    nodes: graph.nodes.map((n) => {
      const p = placed.get(n.id);
      return {
        ...base(n),
        x: round(p?.x || 0),
        y: round(p?.y || 0),
        width: round(p?.width || 0),
        height: round(p?.height || 0),
      };
    }),
    edges: graph.edges.map((e) => {
      const route = routes.get(e.id);
      const section = route?.sections?.[0];
      const label = route?.labels?.[0];
      return {
        ...link(
          e,
          section
            ? [
                section.startPoint,
                ...(section.bendPoints || []),
                section.endPoint,
              ]
            : [],
        ),
        ...(label && label.x !== undefined && label.y !== undefined
          ? {
              labelAt: {
                x: round(label.x + (label.width || 0) / 2),
                y: round(label.y + (label.height || 0) - 3),
              },
            }
          : {}),
      };
    }),
    lanes: [],
  };
}

function sequence(graph: UnionGraph): Geometry {
  const participants = graph.nodes;
  const column = Math.max(
    150,
    ...participants.map((n) => nodeSize(n).width + 24),
  );
  const center = new Map(
    participants.map((n, i) => [n.id, 16 + column * i + column / 2]),
  );
  const messages = graph.edges
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.order ?? a.i) - (b.e.order ?? b.i) || a.i - b.i);
  const top = 16,
    header = 38,
    row = 40;
  const height = top + header + 28 + messages.length * row + 16;
  const nodes = participants.map((n) => ({
    ...base(n),
    x: round((center.get(n.id) || 0) - (column - 24) / 2),
    y: top,
    width: column - 24,
    height: header,
  }));
  const edges = messages.map(({ e }, i) => {
    const y = top + header + 34 + i * row;
    const from = center.get(e.from) || 0,
      to = center.get(e.to) || 0;
    const points =
      from === to
        ? [
            { x: from, y },
            { x: from + 36, y },
            { x: from + 36, y: y + 14 },
            { x: from, y: y + 14 },
          ]
        : [
            { x: from, y },
            { x: to, y },
          ];
    return {
      ...link(e, points),
      ...(e.label
        ? {
            labelAt: {
              x: round((from + to) / 2 + (from === to ? 60 : 0)),
              y: y - 6,
            },
          }
        : {}),
    };
  });
  return {
    width: Math.ceil(32 + column * participants.length),
    height,
    nodes,
    edges,
    lanes: participants.map((n) => ({
      id: n.id,
      label: n.label,
      x: center.get(n.id) || 0,
      y: top + header,
      width: 0,
      height: height - top - header - 8,
    })),
  };
}

function timeline(
  graph: UnionGraph,
  axis: NonNullable<Graph["axis"]>,
  lanes: Graph["lanes"],
): Geometry {
  const laneList = lanes?.length
    ? lanes
    : [
        ...new Set(graph.nodes.flatMap((n) => (n.span ? [n.span.lane] : []))),
      ].map((id) => ({ id, label: id }));
  const gutter = 104,
    plot = 470,
    top = 34,
    row = 46;
  const x = (t: number) =>
    gutter + ((t - axis.min) / (axis.max - axis.min)) * plot;
  const laneIndex = new Map(laneList.map((l, i) => [l.id, i]));
  const others = graph.nodes.filter(
    (n) => !n.span || !laneIndex.has(n.span.lane),
  );
  const rows = laneList.length + (others.length ? 1 : 0);
  const axisY = top + rows * row + 6;
  const nodes = graph.nodes.map((n) => {
    if (n.span && laneIndex.has(n.span.lane)) {
      const left = x(Math.max(axis.min, n.span.start));
      return {
        ...base(n),
        ...(n.span.style === "ghost" ? { ghost: true } : {}),
        x: round(left),
        y: top + (laneIndex.get(n.span.lane) || 0) * row + 9,
        width: round(Math.max(8, x(Math.min(axis.max, n.span.end)) - left)),
        height: 28,
      };
    }
    const i = others.indexOf(n);
    const size = nodeSize(n);
    return {
      ...base(n),
      x: round(gutter + i * (size.width + 12)),
      y: top + laneList.length * row + 6,
      width: size.width,
      height: 30,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges.map((e) => {
    const from = byId.get(e.from),
      to = byId.get(e.to);
    const points =
      from && to
        ? [
            { x: from.x + from.width, y: from.y + from.height / 2 },
            { x: to.x, y: to.y + to.height / 2 },
          ]
        : [];
    return {
      ...link(e, points),
      ...(e.label && points.length
        ? {
            labelAt: {
              x: round((points[0].x + points[1].x) / 2),
              y: round(points[0].y - 8),
            },
          }
        : {}),
    };
  });
  const span = axis.max - axis.min;
  const format = (t: number) =>
    `${Number.isInteger(t) ? t : Number(t.toFixed(2))}${axis.unit}`;
  return {
    width: gutter + plot + 40,
    height: axisY + 30,
    nodes,
    edges,
    lanes: laneList.map((l, i) => ({
      id: l.id,
      label: l.label,
      x: 8,
      y: top + i * row,
      width: gutter + plot,
      height: row,
    })),
    axis: {
      y: axisY,
      x0: gutter,
      x1: gutter + plot,
      ticks: Array.from({ length: 5 }, (_, i) => {
        const t = axis.min + (span * i) / 4;
        return { label: format(Number(t.toFixed(6))), x: round(x(t)) };
      }),
      marks: (axis.marks || []).map((m) => ({
        label: m.label,
        x: round(x(Math.min(axis.max, Math.max(axis.min, m.at)))),
        kind: m.kind || "event",
      })),
    },
  };
}

/** Deterministic geometry for a diagram; empty graphs lay out as an empty box. */
export async function layoutDiagram(
  diagram: Pick<Diagram, "kind" | "before" | "after">,
  { streaming = false } = {},
): Promise<{ geometry: Geometry; union: UnionGraph }> {
  const union = unionGraph(diagram, { streaming });
  const axis = diagram.after.axis;
  if (diagram.kind === "timeline" && axis)
    return { geometry: timeline(union, axis, diagram.after.lanes), union };
  if (!union.nodes.length)
    return {
      geometry: { width: 320, height: 120, nodes: [], edges: [], lanes: [] },
      union,
    };
  if (diagram.kind === "sequence") return { geometry: sequence(union), union };
  return {
    geometry: await layered(union, diagram.kind === "flow" ? "DOWN" : "RIGHT"),
    union,
  };
}
export type { Geometry };
