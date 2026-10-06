import type * as Code from "vscode";
import type { ViewApi } from "./native.js";
import type { TourSnapshot } from "../shared/snapshot.js";
import type { DiagramView } from "../shared/diagram-view.js";
import type { HostMessage } from "../shared/messages.js";
import { REVISIONED_MESSAGE_TYPES } from "../shared/messages.js";
import { isRecord, errorMessage } from "./requests.js";
import { webviewHtml, webviewOptions } from "./tour-view.js";
import {
  dispatchDiagramMessage,
  type DiagramActions,
} from "./diagram-actions.js";

// The expanded diagram in an editor tab beside the code. It shows one diagram
// and, while following the tour, switches to the current stop's diagram.

export interface PanelApi extends ViewApi {
  window: Pick<typeof Code.window, "createWebviewPanel">;
  ViewColumn: Pick<typeof Code.ViewColumn, "Beside">;
}

export function findView(
  snapshot: TourSnapshot,
  id: string,
): DiagramView | undefined {
  if (!snapshot.loaded) return undefined;
  const detour = snapshot.diagrams.detour?.diagram;
  return (
    snapshot.diagrams.cards.find((c) => c.id === id) ||
    (detour?.id === id ? detour : undefined)
  );
}

export function createDiagramPanel(
  vscode: PanelApi,
  extensionUri: Code.Uri,
  actions: () => DiagramActions | undefined,
  notify: (message: HostMessage) => unknown = () => {},
) {
  let panel: Code.WebviewPanel | undefined;
  let latest: TourSnapshot = { loaded: false, revision: 0 };
  let view: DiagramView | null = null;
  let follow = true;
  let stopId: string | undefined;
  const post = () => {
    const message: HostMessage = {
      type: "panel",
      view: panel ? view : null,
      follow,
    };
    notify(message);
    if (!panel) return;
    if (view) panel.title = view.tabTitle;
    void panel.webview.postMessage({
      type: "snapshot",
      snapshot: latest,
    } satisfies HostMessage);
    void panel.webview.postMessage(message);
  };
  function create() {
    const created = vscode.window.createWebviewPanel(
      "kanko.diagram",
      view?.tabTitle || "Diagram",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        ...webviewOptions(vscode, extensionUri),
        retainContextWhenHidden: true,
      },
    );
    created.iconPath = vscode.Uri.joinPath(
      extensionUri,
      "assets",
      "kanko-sidebar.svg",
    );
    created.webview.html = webviewHtml(
      vscode,
      extensionUri,
      created.webview,
      "diagram",
    );
    created.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isRecord(message)) return;
      try {
        if (message.type === "ready") return post();
        if (
          REVISIONED_MESSAGE_TYPES.some((type) => type === message.type) &&
          !Number.isInteger(message.revision)
        )
          throw new Error(
            "Use the latest tour snapshot before changing the presentation.",
          );
        await dispatchDiagramMessage(actions(), message);
      } catch (error) {
        void created.webview.postMessage({
          type: "error",
          message: errorMessage(error),
        } satisfies HostMessage);
      }
    });
    created.onDidDispose(() => {
      if (panel === created) {
        panel = undefined;
        post();
      }
    });
    return created;
  }
  return {
    isOpen: () => Boolean(panel),
    show(diagramId: string) {
      const found = findView(latest, diagramId);
      if (!found)
        throw Object.assign(new Error("That diagram is not on this stop."), {
          code: "bad_request",
        });
      view = found;
      if (panel) panel.reveal(vscode.ViewColumn.Beside, true);
      else panel = create();
      post();
    },
    setFollow(value: boolean) {
      follow = value;
      post();
    },
    /** Keep the open diagram current; while following, a new stop's diagram
     * replaces it. `always` opens a stop's diagram when the stop starts. */
    publish(snapshot: TourSnapshot) {
      latest = snapshot;
      if (!snapshot.loaded) {
        view = null;
        stopId = undefined;
        panel?.dispose();
        return;
      }
      // Off means no diagrams anywhere, including an open panel.
      if (snapshot.diagrams.settings.mode === "off") {
        view = null;
        stopId = snapshot.stop.id;
        panel?.dispose();
        return;
      }
      const changedStop = snapshot.stop.id !== stopId;
      stopId = snapshot.stop.id;
      const first = snapshot.diagrams.cards[0];
      if (view) view = findView(snapshot, view.id) || view;
      if (changedStop && first && (follow || !view)) view = first;
      if (
        changedStop &&
        first &&
        !panel &&
        snapshot.diagrams.settings.openBeside === "always"
      )
        panel = create();
      post();
    },
    dispose() {
      panel?.dispose();
    },
  };
}
export type DiagramPanel = ReturnType<typeof createDiagramPanel>;
