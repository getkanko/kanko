import { useState, type ReactNode } from "react";
import type { DiagramView, PositionedNode } from "../../shared/diagram-view.js";
import { DiagramCanvas } from "./DiagramCanvas.js";
import type { GraphMode } from "../diagram-model.js";

const CARD_LIMIT = 12;

export function KindIcon() {
  return (
    <svg className="dg-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="6" height="4" rx="1" />
      <rect x="8.5" y="10.5" width="6" height="4" rx="1" />
      <path d="M4.5 5.5v7h4" />
    </svg>
  );
}

/** A diagram card: header, reason, the drawing, and its actions. Clicking an
 * unanchored sketch node only explains that it has no code location. */
export function DiagramCard({
  view,
  beatId,
  jump,
  openBeside,
  notHelpful,
  redraw,
  redrawAt,
  status,
  mode = "after",
  children,
}: {
  view: DiagramView;
  beatId: string | null;
  jump(node: PositionedNode): void;
  openBeside?: () => void;
  notHelpful?: () => void;
  redraw?: () => void;
  redrawAt?: string;
  status?: string;
  mode?: GraphMode;
  children?: ReactNode;
}) {
  const [note, setNote] = useState("");
  const [describe, setDescribe] = useState(false);
  const thumbnail = view.nodeCount > CARD_LIMIT;
  const activate = (node: PositionedNode) => {
    if (node.location) {
      setNote("");
      jump(node);
    } else setNote(`${node.label}: sketched, with no code location.`);
  };
  return (
    <section
      className={`dg-card${view.status === "inferred" && !view.streaming ? " dg-inferred" : ""}${view.stale ? " dg-stale-card" : ""}`}
      aria-label={`Diagram: ${view.title}`}
      data-diagram={view.id}
    >
      <header className="dg-header">
        <KindIcon />
        <h3>{view.title}</h3>
        <span
          className={`dg-chip dg-chip-${view.streaming ? "drawing" : view.stale ? "stale" : view.status}`}
        >
          {view.chip}
        </span>
      </header>
      {view.reason && <p className="dg-reason">{view.reason}</p>}
      {thumbnail ? (
        <div className="dg-thumbnail">
          <DiagramCanvas
            view={view}
            beatId={beatId}
            mode={mode}
            activate={activate}
            thumbnail
          />
          <p className="muted">
            {view.nodeCount} nodes is too many for the card.{" "}
            {openBeside && (
              <button className="dg-link" onClick={openBeside}>
                Open the full diagram
              </button>
            )}
          </p>
        </div>
      ) : (
        <div className="dg-canvas">
          <DiagramCanvas
            view={view}
            beatId={beatId}
            mode={mode}
            activate={activate}
          />
        </div>
      )}
      {status && (
        <p className="dg-status" role="status">
          {status}
        </p>
      )}
      <p className="dg-note" role="status" hidden={!note}>
        {note}
      </p>
      {describe && (
        <ol className="dg-description" aria-label={`${view.title} as text`}>
          {view.description.after.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
      <footer className="dg-footer">
        <span className="dg-legend">
          <span className="dg-swatch" aria-hidden="true" /> this beat ·{" "}
          {view.streaming
            ? "still drawing; checked against the code when done"
            : view.status === "inferred"
              ? "sketched by Kankō; not proof"
              : "click any node to jump to its code"}
        </span>
        <span className="dg-actions">
          <button
            className="dg-describe"
            aria-pressed={describe}
            onClick={() => setDescribe(!describe)}
          >
            Describe as text
          </button>
          {view.stale && redraw && (
            <button className="dg-redraw primary" onClick={redraw}>
              Redraw at {redrawAt}
            </button>
          )}
          {openBeside && !thumbnail && (
            <button className="dg-open" onClick={openBeside}>
              Open beside code
            </button>
          )}
          {notHelpful && (
            <button className="dg-not-helpful" onClick={notHelpful}>
              Not helpful
            </button>
          )}
          {children}
        </span>
      </footer>
    </section>
  );
}
