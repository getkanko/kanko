import { useEffect, useState, useSyncExternalStore } from "react";
import type { SidebarBridge } from "./bridge.js";
import type { DiagramView } from "../shared/diagram-view.js";
import { DiagramCanvas } from "./components/DiagramCanvas.js";
import {
  beatStrip,
  defaultMode,
  sideOf,
  type GraphMode,
} from "./diagram-model.js";

/** The expanded diagram beside the code: Before/After/Diff, Follow tour, and a
 * beat strip. Panning or clicking the background stops auto-scrolling until
 * Return to tour, like exploring in the editor. */
export function DiagramPanelApp({ bridge }: { bridge: SidebarBridge }) {
  const { snapshot, panel, error } = useSyncExternalStore(
    bridge.subscribe,
    bridge.getState,
  );
  useEffect(() => {
    bridge.ready();
  }, [bridge]);
  const view = panel?.view;
  return (
    <main className="dg-panel">
      {view && snapshot.loaded ? (
        <Expanded
          key={view.id}
          view={view}
          follow={panel.follow}
          beatId={snapshot.beat.id}
          stopId={snapshot.stop.id}
          beats={snapshot.stop.id === view.stopId ? snapshot.stop.beats : []}
          bridge={bridge}
        />
      ) : (
        <p className="muted">
          No diagram is open. Choose Open beside code on a diagram.
        </p>
      )}
      <p id="error" role="alert">
        {error}
      </p>
    </main>
  );
}

function Expanded({
  view,
  follow,
  beatId,
  stopId,
  beats,
  bridge,
}: {
  view: DiagramView;
  follow: boolean;
  beatId: string;
  stopId: string;
  beats: { id: string }[];
  bridge: SidebarBridge;
}) {
  const [mode, setMode] = useState<GraphMode>(defaultMode(view));
  const [exploring, setExploring] = useState(false);
  const [frozenBeat, setFrozenBeat] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const onStop = view.stopId === stopId;
  // Without Follow tour the highlight stays on the beat it was turned off at.
  const shownBeat = follow ? (onStop ? beatId : null) : frozenBeat;
  const strip = beatStrip(view, beats);
  const modes: GraphMode[] = view.diffable
    ? ["before", "after", "diff"]
    : ["after"];
  return (
    <section
      id="diagram-panel"
      className={view.stale ? "dg-stale-card" : undefined}
    >
      <div className="dg-toolbar">
        <div className="dg-segmented" role="group" aria-label="Diagram version">
          {(["before", "after", "diff"] as const).map((value) => (
            <button
              key={value}
              data-mode={value}
              aria-pressed={mode === value}
              hidden={!modes.includes(value)}
              onClick={() => setMode(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <label className="dg-follow">
          <input
            type="checkbox"
            id="follow-tour"
            checked={follow}
            onChange={(event) => {
              if (!event.target.checked) setFrozenBeat(onStop ? beatId : null);
              setExploring(false);
              bridge.send({
                type: "panelFollow",
                follow: event.target.checked,
              });
            }}
          />
          Follow tour
        </label>
        <span
          className={`dg-chip dg-chip-${view.stale ? "stale" : view.status}`}
        >
          {view.stale ? view.chip : view.revisionChip}
        </span>
      </div>
      {!view.diffable && view.hasBefore && (
        <p className="muted">
          The before and after drawings could not be matched reliably, so only
          After is shown.
        </p>
      )}
      {exploring && follow && (
        <button id="diagram-return" onClick={() => setExploring(false)}>
          Return to tour
        </button>
      )}
      <div
        className="dg-viewport"
        onWheel={() => setExploring(true)}
        onPointerDown={(event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest("[data-node]")
          )
            setExploring(true);
        }}
      >
        <DiagramCanvas
          view={view}
          beatId={shownBeat}
          mode={mode}
          scrollToBeat={follow && !exploring}
          activate={(node) => {
            if (!node.location) {
              setNote(`${node.label}: sketched, with no code location.`);
              return;
            }
            setNote("");
            bridge.send({
              type: "diagramNode",
              diagramId: view.id,
              nodeId: node.id,
              ...(sideOf(node, mode) === "before"
                ? { side: "before" as const }
                : {}),
            });
          }}
        />
      </div>
      <p className="dg-note" role="status" hidden={!note}>
        {note}
      </p>
      <div className="dg-legend-row" aria-hidden={mode !== "diff"}>
        {mode === "diff" && (
          <>
            <span className="dg-key dg-key-new">new</span>
            <span className="dg-key dg-key-changed">changed</span>
            <span className="dg-key dg-key-removed">removed</span>
            <span className="dg-key">unchanged</span>
          </>
        )}
        <span className="dg-key dg-key-current">this beat</span>
      </div>
      {strip.length > 0 && (
        <nav className="dg-beats" aria-label="Beats in this diagram">
          {strip.map((chip) => (
            <button
              key={chip.id}
              aria-pressed={chip.id === shownBeat}
              onClick={() =>
                bridge.send({
                  type: "gotoBeat",
                  stopId: view.stopId,
                  beatId: chip.id,
                })
              }
            >
              {chip.index + 1} · {chip.label}
            </button>
          ))}
        </nav>
      )}
      <details className="dg-text">
        <summary>Describe as text</summary>
        <ol aria-label={`${view.title} as text`}>
          {view.description.after.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
        {view.description.before && (
          <>
            <p className="muted">Before</p>
            <ol>
              {view.description.before.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </>
        )}
      </details>
    </section>
  );
}
