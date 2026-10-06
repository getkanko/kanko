import type * as Code from "vscode";
import type { TourController } from "./tour-controller.js";
import type { ReviewerEvents } from "./reviewer-events.js";
import type { DiagramSettings } from "../shared/diagram-view.js";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { readDiagramSettings } from "../../../generated/shared/diagram.js";
import {
  anchorForNode,
  expandStop,
  markNotHelpful,
  pinDiagram,
  requestDiagram,
  returnToTour,
} from "./diagrams.js";

// Reviewer actions on diagrams. Node clicks, view toggles and beat sync stay
// local; requests, feedback and pins also queue an event for the agent.

export interface DiagramActionApi {
  Uri: Pick<typeof Code.Uri, "file">;
  Range: typeof Code.Range;
  window: Pick<
    typeof Code.window,
    "showTextDocument" | "showInformationMessage"
  >;
  workspace: Pick<typeof Code.workspace, "getConfiguration">;
  ConfigurationTarget: Pick<typeof Code.ConfigurationTarget, "Global">;
}

const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const SETTING_KEYS = [
  "mode",
  "maxPerStop",
  "derivedOnly",
  "openBeside",
] as const;

export function createDiagramActions(
  vscode: DiagramActionApi,
  controller: () => TourController,
  events: ReviewerEvents,
  panel: () =>
    | { show(diagramId: string): unknown; setFollow(follow: boolean): void }
    | undefined,
) {
  const loaded = () => {
    const snapshot = controller().snapshot();
    if (!snapshot.loaded) throw fail("no_tour", "Load a tour first.");
    return snapshot;
  };
  return {
    /** Move the presenter pointer to a node's anchor, activating its first
     * beat when the current beat does not already show it. */
    async node(
      diagramId: string,
      nodeId: string,
      revision: number,
      side: "before" | "after" = "after",
    ) {
      const snapshot = loaded();
      const record = controller().diagrams()?.records[diagramId];
      const plan = controller().plan();
      if (!record || !plan) throw fail("bad_request", "Unknown diagram.");
      const graphs =
        side === "before"
          ? [record.before, record.after]
          : [record.after, record.before];
      const node = graphs
        .flatMap((graph) => graph?.nodes || [])
        .find((n) => n.id === nodeId);
      if (!node?.anchor)
        throw fail(
          "bad_request",
          "This node is a sketch and has no code location.",
        );
      const stop = plan.stops.find((s) => s.id === record.stopId);
      if (!stop)
        throw fail("bad_request", "The diagram's stop is not in this tour.");
      let expected = revision;
      const beats = node.beatIds || [];
      if (
        snapshot.stop.id !== stop.id ||
        (beats.length && !beats.includes(snapshot.beat.id))
      ) {
        const moved = await controller().navigate({
          action: "goto",
          stopId: stop.id,
          beatId: beats[0] || stop.beats[0].id,
          expectedRevision: expected,
        });
        expected = moved.revision;
      }
      const anchor = anchorForNode(stop, node.anchor);
      if (anchor !== null)
        return controller().focus({ anchor, expectedRevision: expected });
      // Not one of the stop's files: open the head file at the node's lines.
      const workspace = snapshot.loaded && controller().workspace();
      if (!workspace || node.anchor.side !== "head")
        return vscode.window.showInformationMessage(
          `${node.label} is in ${node.anchor.path}, which this stop does not show.`,
        );
      const { startLine, endLine } = node.anchor.context;
      return vscode.window.showTextDocument(
        vscode.Uri.file(path.join(workspace, node.anchor.path)),
        {
          selection: new vscode.Range(startLine - 1, 0, endLine - 1, 0),
          preview: true,
        },
      );
    },
    gotoBeat(stopId: string, beatId: string, revision: number) {
      return controller().navigate({
        action: "goto",
        stopId,
        beatId,
        expectedRevision: revision,
      });
    },
    open(diagramId: string) {
      loaded();
      return panel()?.show(diagramId);
    },
    request(stopId: string, replaces?: string) {
      const snapshot = loaded();
      if (snapshot.diagrams.settings.mode === "off")
        throw fail("bad_request", "Diagrams are turned off.");
      const id = `req_${crypto.randomUUID()}`;
      events.push({
        kind: "diagram_request",
        id,
        mapId: snapshot.tourId,
        stopId,
        ...(replaces ? { replaces } : {}),
        context: {
          stopId: snapshot.stop.id,
          beatId: snapshot.beat.id,
          mode: snapshot.mode,
          selectedAnchor: snapshot.selectedAnchor,
        },
      });
      return controller().updateDiagrams(snapshot.tourId, (d) =>
        requestDiagram(d, stopId, id, replaces),
      );
    },
    feedback(diagramId: string) {
      const snapshot = loaded();
      const next = controller().updateDiagrams(snapshot.tourId, (d) =>
        markNotHelpful(d, diagramId),
      );
      events.push({
        kind: "diagram_feedback",
        id: `fb_${crypto.randomUUID()}`,
        mapId: snapshot.tourId,
        diagramId,
        value: "not_helpful",
      });
      return next;
    },
    async pin(diagramId: string, stopId: string) {
      const snapshot = loaded();
      const next = await controller().updateDiagrams(
        snapshot.tourId,
        (d, state) => pinDiagram(d, state.plan, diagramId, stopId),
      );
      events.push({
        kind: "diagram_pin",
        id: `pin_${crypto.randomUUID()}`,
        mapId: snapshot.tourId,
        diagramId,
        stopId,
      });
      return next;
    },
    expand(stopId: string) {
      const snapshot = loaded();
      return controller().updateDiagrams(snapshot.tourId, (d) =>
        expandStop(d, stopId),
      );
    },
    returnToTour() {
      const snapshot = loaded();
      return controller().updateDiagrams(snapshot.tourId, (d) =>
        returnToTour(d),
      );
    },
    async settings(changes: Partial<DiagramSettings>) {
      const config = vscode.workspace.getConfiguration("kanko.diagrams");
      const current = readDiagramSettings(
        Object.fromEntries(SETTING_KEYS.map((key) => [key, config.get(key)])),
      );
      const next = readDiagramSettings({ ...current, ...changes });
      for (const key of SETTING_KEYS)
        if (changes[key] !== undefined && next[key] === changes[key])
          await config.update(
            key,
            next[key],
            vscode.ConfigurationTarget.Global,
          );
    },
    follow(follow: boolean) {
      panel()?.setFollow(follow);
    },
  };
}
export type DiagramActions = ReturnType<typeof createDiagramActions>;

/** Route a webview diagram message to its action. Returns false for other messages. */
export async function dispatchDiagramMessage(
  actions: DiagramActions | undefined,
  message: Record<string, unknown>,
): Promise<boolean> {
  if (!actions) return false;
  const text = (key: string) => {
    const value = message[key];
    if (typeof value !== "string" || !value)
      throw fail("bad_request", `${key} is required.`);
    return value;
  };
  switch (message.type) {
    case "diagramNode":
      await actions.node(
        text("diagramId"),
        text("nodeId"),
        Number(message.revision),
        message.side === "before" ? "before" : "after",
      );
      return true;
    case "gotoBeat":
      await actions.gotoBeat(
        text("stopId"),
        text("beatId"),
        Number(message.revision),
      );
      return true;
    case "diagramOpen":
      await actions.open(text("diagramId"));
      return true;
    case "diagramRequest":
      await actions.request(
        text("stopId"),
        typeof message.replaces === "string" ? message.replaces : undefined,
      );
      return true;
    case "diagramFeedback":
      await actions.feedback(text("diagramId"));
      return true;
    case "diagramPin":
      await actions.pin(text("diagramId"), text("stopId"));
      return true;
    case "diagramExpand":
      await actions.expand(text("stopId"));
      return true;
    case "detourReturn":
      await actions.returnToTour();
      return true;
    case "diagramSettings":
      if (message.settings && typeof message.settings === "object")
        await actions.settings(message.settings as Partial<DiagramSettings>);
      return true;
    case "panelFollow":
      actions.follow(message.follow === true);
      return true;
    default:
      return false;
  }
}
