import { useState } from "react";
import type { LoadedTourSnapshot } from "../../shared/snapshot.js";
import type {
  DiagramSettings,
  DiagramView,
  TourMapEntry,
} from "../../shared/diagram-view.js";
import type { SidebarBridge } from "../bridge.js";
import { DiagramCard, KindIcon } from "./DiagramCard.js";

type Send = SidebarBridge["send"];

/** Diagram cards and states for the current stop, under the beat narration. */
export function StopDiagrams({
  snapshot,
  send,
  openId,
}: {
  snapshot: LoadedTourSnapshot;
  send: Send;
  openId: string | null;
}) {
  const d = snapshot.diagrams;
  if (d.settings.mode === "off") return null;
  const stopId = snapshot.stop.id;
  const draw = (replaces?: string) =>
    send({ type: "diagramRequest", stopId, ...(replaces ? { replaces } : {}) });
  if (d.collapsed && d.cards.length)
    return (
      <p id="diagram-collapsed" className="dg-row muted">
        Diagram hidden for this stop.{" "}
        <button
          className="dg-link"
          onClick={() => send({ type: "diagramExpand", stopId })}
        >
          Show diagram
        </button>
      </p>
    );
  return (
    <div id="diagrams">
      {d.cards.map((view: DiagramView) =>
        openId === view.id ? (
          <p key={view.id} className="dg-row dg-open-row">
            <KindIcon /> Diagram open beside code
          </p>
        ) : (
          <DiagramCard
            key={view.id}
            view={view}
            beatId={snapshot.beat.id}
            redrawAt={d.redrawAt}
            jump={(node) =>
              send({ type: "diagramNode", diagramId: view.id, nodeId: node.id })
            }
            openBeside={
              d.settings.openBeside === "never"
                ? undefined
                : () => send({ type: "diagramOpen", diagramId: view.id })
            }
            notHelpful={() =>
              send({ type: "diagramFeedback", diagramId: view.id })
            }
            redraw={() => draw(view.id)}
          />
        ),
      )}
      {!d.cards.length && d.pending && (
        <p id="diagram-pending" className="dg-row muted" role="status">
          Kankō is drawing a diagram for this stop…
        </p>
      )}
      {!d.cards.length && !d.pending && d.skip && (
        <div id="diagram-skip" className="dg-row dg-skip">
          <span className="dg-chip dg-state-skipped">no diagram</span>
          <span className="muted">{d.skip.reason}</span>
          <button onClick={() => draw()}>Draw one anyway</button>
        </div>
      )}
    </div>
  );
}

const STATE_LABEL: Record<TourMapEntry["state"], string> = {
  auto: "drawn automatically",
  requested: "you asked",
  skipped: "no diagram",
  pending: "drawing…",
  none: "not decided",
};

/** Per-stop diagram state and the diagram settings. */
export function TourMap({
  snapshot,
  send,
}: {
  snapshot: LoadedTourSnapshot;
  send: Send;
}) {
  const d = snapshot.diagrams;
  const off = d.settings.mode === "off";
  // Rendered only when open, so its controls stay out of the page otherwise.
  const [open, setOpen] = useState(false);
  return (
    <details
      id="tour-map"
      className="dg-map"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{off ? "Diagram settings" : "Diagrams in this tour"}</summary>
      {open && !off && (
        <ul className="dg-map-list">
          {d.tourMap.map((entry) => (
            <li
              key={entry.stopId}
              className={entry.current ? "current" : undefined}
              data-stop={entry.stopId}
            >
              <span className={`dg-chip dg-state-${entry.state}`}>
                {STATE_LABEL[entry.state]}
              </span>
              <button
                className="dg-link"
                disabled={entry.current}
                onClick={() =>
                  send({
                    type: "gotoBeat",
                    stopId: entry.stopId,
                    beatId: entry.firstBeatId,
                  })
                }
              >
                {entry.label} · {entry.title}
              </button>
              {entry.reason && (
                <span className="muted dg-map-reason">{entry.reason}</span>
              )}
              {entry.state === "skipped" && (
                <button
                  onClick={() =>
                    send({ type: "diagramRequest", stopId: entry.stopId })
                  }
                >
                  Draw one anyway
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <DiagramSettingsForm
          settings={d.settings}
          change={(settings) => send({ type: "diagramSettings", settings })}
        />
      )}
    </details>
  );
}

function DiagramSettingsForm({
  settings,
  change,
}: {
  settings: DiagramSettings;
  change(settings: Partial<DiagramSettings>): void;
}) {
  const modes: [DiagramSettings["mode"], string][] = [
    ["auto", "Kankō decides"],
    ["onRequest", "Only when I ask"],
    ["off", "Off"],
  ];
  return (
    <fieldset className="dg-settings">
      <legend>Diagrams in tours</legend>
      {modes.map(([value, label]) => (
        <label key={value}>
          <input
            type="radio"
            name="diagram-mode"
            value={value}
            checked={settings.mode === value}
            onChange={() => change({ mode: value })}
          />
          {label}
        </label>
      ))}
      <label>
        Automatic diagrams per stop{" "}
        <select
          id="diagram-max"
          value={settings.maxPerStop}
          onChange={(event) =>
            change({ maxPerStop: Number(event.target.value) })
          }
        >
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          id="diagram-derived-only"
          checked={settings.derivedOnly}
          onChange={(event) => change({ derivedOnly: event.target.checked })}
        />
        Only from code or traces, no sketches
      </label>
      <label>
        Open beside code{" "}
        <select
          id="diagram-open-beside"
          value={settings.openBeside}
          onChange={(event) =>
            change({
              openBeside: event.target.value as DiagramSettings["openBeside"],
            })
          }
        >
          <option value="ask">When I choose</option>
          <option value="always">Always</option>
          <option value="never">Never</option>
        </select>
      </label>
    </fieldset>
  );
}

/** A reviewer's diagram request: the drawing streams in, then can be pinned. */
export function DetourPanel({
  snapshot,
  send,
}: {
  snapshot: LoadedTourSnapshot;
  send: Send;
}) {
  const detour = snapshot.diagrams.detour;
  if (!detour) return null;
  const back = () => send({ type: "detourReturn" });
  const view = detour.diagram;
  return (
    <section id="detour" aria-label="Detour">
      <nav className="dg-breadcrumb" aria-label="Breadcrumb">
        <span>Tour</span> ›{" "}
        <span>
          {detour.stopLabel} {detour.stopTitle}
        </span>{" "}
        › <strong>Detour</strong>
        <button id="detour-return" onClick={back}>
          Return to tour
        </button>
      </nav>
      {detour.question && <p className="dg-question">{detour.question}</p>}
      {detour.answer && <p className="dg-answer">{detour.answer}</p>}
      {view ? (
        <DiagramCard
          view={view}
          beatId={snapshot.stop.id === view.stopId ? snapshot.beat.id : null}
          status={detour.final ? undefined : detour.status}
          jump={(node) =>
            view.streaming
              ? undefined
              : send({
                  type: "diagramNode",
                  diagramId: view.id,
                  nodeId: node.id,
                })
          }
          openBeside={
            detour.final && snapshot.diagrams.settings.openBeside !== "never"
              ? () => send({ type: "diagramOpen", diagramId: view.id })
              : undefined
          }
        >
          {detour.final && (
            <button
              id="detour-pin"
              disabled={detour.pinned}
              onClick={() =>
                send({
                  type: "diagramPin",
                  diagramId: view.id,
                  stopId: detour.stopId,
                })
              }
            >
              {detour.pinned
                ? `Pinned to ${detour.stopLabel}`
                : `Pin to ${detour.stopLabel}`}
            </button>
          )}
        </DiagramCard>
      ) : (
        <p className="dg-status" role="status">
          {detour.status || "Waiting for Kankō…"}
        </p>
      )}
      <button
        id="detour-return-bottom"
        className="primary dg-return"
        onClick={back}
      >
        Return to tour at{" "}
        {snapshot.diagrams.tourMap.find((e) => e.current)?.label || "stop"},
        beat {snapshot.beatIndex + 1}
      </button>
    </section>
  );
}
