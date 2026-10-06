import { useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import type {
  DiagramView,
  PositionedEdge,
  PositionedNode,
} from "../../shared/diagram-view.js";
import {
  highlighted,
  nodeLabel,
  readingOrder,
  visible,
  type GraphMode,
} from "../diagram-model.js";

// A span narrower than its label keeps the label in its tooltip and the text
// description instead of overflowing its neighbours.
const fits = (node: PositionedNode) =>
  node.shape !== "span" || node.label.length * 6.6 + 12 <= node.width;

const pathFor = (points: PositionedEdge["points"]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");

function nodeClasses(
  node: PositionedNode,
  mode: GraphMode,
  current: boolean,
): string {
  return [
    "dg-node",
    `dg-${node.shape}`,
    mode === "diff" ? `dg-${node.status}` : "",
    current ? "dg-current" : "",
    node.claims.some((c) => c.attention) ? "dg-attention" : "",
    node.placeholder ? "dg-placeholder" : "",
    node.ghost ? "dg-ghost" : "",
    node.location ? "dg-anchored" : "dg-unanchored",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The diagram as SVG. Nodes are focusable in reading order; Enter jumps to
 * code and arrow keys follow edges. */
export function DiagramCanvas({
  view,
  beatId,
  mode,
  activate,
  thumbnail = false,
  scrollToBeat = false,
}: {
  view: DiagramView;
  beatId: string | null;
  mode: GraphMode;
  activate(node: PositionedNode): void;
  thumbnail?: boolean;
  scrollToBeat?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const marker = `dg-arrow-${useId().replace(/[^\w-]/g, "")}`;
  const { nodes: hot, edges: hotEdges } = highlighted(view, beatId);
  const nodes = readingOrder(visible(view.layout.nodes, mode));
  const shown = new Set(nodes.map((n) => n.id));
  const edges = visible(view.layout.edges, mode).filter(
    (e) => shown.has(e.from) && shown.has(e.to),
  );
  const { layout } = view;
  const axis = layout.axis;
  useLayoutEffect(() => {
    if (!scrollToBeat) return;
    const target = ref.current?.querySelector(".dg-current");
    (
      target as Element & { scrollIntoView?: (o: object) => void }
    )?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [scrollToBeat, beatId, view.id, mode]);
  const focusNode = (id: string) => {
    const target = [
      ...(ref.current?.querySelectorAll<SVGGElement>("[data-node]") || []),
    ].find((el) => el.dataset.node === id);
    target?.focus();
  };
  const keyDown = (event: KeyboardEvent, node: PositionedNode) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(node);
      return;
    }
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !back) return;
    const edge = edges.find((e) => (forward ? e.from : e.to) === node.id);
    if (!edge) return;
    event.preventDefault();
    focusNode(forward ? edge.to : edge.from);
  };
  return (
    <svg
      ref={ref}
      className={`dg-svg${thumbnail ? " dg-thumb" : ""}${view.status === "inferred" && !view.streaming ? " dg-inferred" : ""}${view.stale ? " dg-stale" : ""}`}
      role="img"
      aria-label={view.aria}
      viewBox={`0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`}
      width={layout.width}
      style={{ maxWidth: "100%", height: "auto" }}
      preserveAspectRatio="xMidYMin meet"
    >
      <defs>
        <marker
          id={marker}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" className="dg-arrowhead" />
        </marker>
      </defs>
      {layout.lanes.map((lane) =>
        view.kind === "sequence" ? (
          <line
            key={lane.id}
            className="dg-lifeline"
            x1={lane.x}
            x2={lane.x}
            y1={lane.y}
            y2={lane.y + lane.height}
          />
        ) : (
          <g key={lane.id} className="dg-lane">
            <line
              x1={lane.x}
              x2={lane.x + lane.width}
              y1={lane.y + lane.height}
              y2={lane.y + lane.height}
            />
            <text x={lane.x} y={lane.y + lane.height / 2 + 4}>
              {lane.label}
            </text>
          </g>
        ),
      )}
      {axis && (
        <g className="dg-axis">
          <line x1={axis.x0} x2={axis.x1} y1={axis.y} y2={axis.y} />
          {axis.ticks.map((tick) => (
            <text key={tick.x} x={tick.x} y={axis.y + 18} textAnchor="middle">
              {tick.label}
            </text>
          ))}
          {axis.marks.map((mark) => (
            <g
              key={`${mark.x}:${mark.label}`}
              className={`dg-mark dg-mark-${mark.kind}`}
            >
              <line x1={mark.x} x2={mark.x} y1={8} y2={axis.y} />
              <text
                x={mark.x}
                y={14}
                textAnchor={mark.x > axis.x1 - 40 ? "end" : "middle"}
              >
                {mark.label}
              </text>
            </g>
          ))}
        </g>
      )}
      {edges.map((edge) => (
        <g
          key={edge.id}
          className={[
            "dg-edge",
            edge.kind ? `dg-edge-${edge.kind}` : "",
            mode === "diff" ? `dg-${edge.status}` : "",
            hotEdges.has(edge.id) ? "dg-current" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-edge={edge.id}
        >
          <path d={pathFor(edge.points)} markerEnd={`url(#${marker})`} />
          {edge.label && edge.labelAt && !thumbnail && (
            <text x={edge.labelAt.x} y={edge.labelAt.y} textAnchor="middle">
              {edge.label}
              {mode === "diff" && edge.was ? ` (was: ${edge.was})` : ""}
            </text>
          )}
        </g>
      ))}
      {nodes.map((node) => {
        const current = hot.has(node.id);
        const radius =
          node.shape === "start" ||
          node.shape === "terminal" ||
          node.shape === "state"
            ? node.height / 2
            : node.shape === "span"
              ? 4
              : 8;
        const cx = node.x + node.width / 2;
        const sub =
          mode === "diff" && node.was ? `was: ${node.was}` : node.sublabel;
        const tag =
          mode === "diff" &&
          (node.status === "new" || node.status === "changed")
            ? node.status
            : null;
        const attention = node.claims.filter((c) => c.attention);
        return (
          <g
            key={node.id}
            className={nodeClasses(node, mode, current)}
            data-node={node.id}
            role={thumbnail || node.placeholder ? undefined : "button"}
            tabIndex={thumbnail || node.placeholder ? undefined : 0}
            aria-label={thumbnail ? undefined : nodeLabel(node, mode)}
            aria-current={current ? "step" : undefined}
            onClick={
              thumbnail || node.placeholder ? undefined : () => activate(node)
            }
            onKeyDown={thumbnail ? undefined : (event) => keyDown(event, node)}
          >
            <title>
              {[
                node.label,
                node.location || "No code location",
                ...node.claims.map((c) => `${c.id} ${c.status}`),
              ].join("\n")}
            </title>
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={radius}
              ry={radius}
            />
            {!thumbnail && !node.placeholder && fits(node) && (
              <text
                x={node.shape === "span" ? node.x + 8 : cx}
                y={node.y + (sub ? node.height / 2 - 3 : node.height / 2 + 4)}
                textAnchor={node.shape === "span" ? "start" : "middle"}
                className="dg-label"
              >
                {node.label}
              </text>
            )}
            {!thumbnail && sub && (
              <text
                x={cx}
                y={node.y + node.height / 2 + 13}
                textAnchor="middle"
                className="dg-sublabel"
              >
                {sub}
              </text>
            )}
            {!thumbnail && tag && (
              <g className="dg-tag">
                <rect
                  x={node.x + node.width - 50}
                  y={node.y - 9}
                  width={44}
                  height={17}
                  rx={8.5}
                />
                <text
                  x={node.x + node.width - 28}
                  y={node.y + 3}
                  textAnchor="middle"
                >
                  {tag}
                </text>
              </g>
            )}
            {!thumbnail && attention.length > 0 && (
              <text
                x={cx}
                y={node.y + node.height + 15}
                textAnchor="middle"
                className="dg-claim"
              >
                {attention.map((c) => `${c.id} ${c.status}`).join(" · ")}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
