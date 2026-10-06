import type { LayoutAction } from "./layout.js";
import type { PresentationMode, TourSnapshot } from "./snapshot.js";
import type { DiagramSettings, DiagramView } from "./diagram-view.js";

export type HostMessage =
  | { type: "snapshot"; snapshot: TourSnapshot }
  /** The expanded diagram panel's subject; also tells the sidebar what is open. */
  | { type: "panel"; view: DiagramView | null; follow: boolean }
  | {
      type: "selectAnchor";
      anchor: number;
      /** Opens the picker; currently unused by the host. */
      move?: boolean;
    }
  | { type: "error"; message: string };

export type NavigationAction =
  "nextBeat" | "previousBeat" | "nextStop" | "previousStop";

/** Include the latest snapshot revision. */
export type Revisioned<T> = T & { revision: number };

export type NavigateMessage = Revisioned<{
  type: "navigate";
  action: NavigationAction;
}>;
export type StateMessage = Revisioned<{
  type: "state";
  mode: PresentationMode;
}>;
export type FocusMessage = Revisioned<{ type: "focus"; anchor: number }>;
export type LayoutMessage = Revisioned<
  { type: "layout" } & Exclude<LayoutAction, { action: "overrideSequence" }>
>;
export type SequenceOverrideMessage = Revisioned<{ type: "sequenceOverride" }>;
/** Move the presenter pointer to a diagram node's code. */
export type DiagramNodeMessage = Revisioned<{
  type: "diagramNode";
  diagramId: string;
  nodeId: string;
}>;
export type GotoBeatMessage = Revisioned<{
  type: "gotoBeat";
  stopId: string;
  beatId: string;
}>;

export type RevisionedMessage =
  | NavigateMessage
  | StateMessage
  | FocusMessage
  | LayoutMessage
  | SequenceOverrideMessage
  | DiagramNodeMessage
  | GotoBeatMessage;

/** Diagram intents that do not change the presentation revision. */
export type DiagramMessage =
  | { type: "diagramOpen"; diagramId: string }
  | { type: "diagramRequest"; stopId: string; replaces?: string }
  | { type: "diagramFeedback"; diagramId: string }
  | { type: "diagramPin"; diagramId: string; stopId: string }
  | { type: "diagramExpand"; stopId: string }
  | { type: "detourReturn" }
  | { type: "diagramSettings"; settings: Partial<DiagramSettings> }
  | { type: "panelFollow"; follow: boolean };

export type UnrevisionedMessage =
  | { type: "ready" }
  | { type: "quickPick"; revision?: number }
  | { type: "clear"; revision?: number }
  | (DiagramMessage & { revision?: number });

export type SidebarMessage = RevisionedMessage | UnrevisionedMessage;

export const REVISIONED_MESSAGE_TYPES = [
  "navigate",
  "state",
  "focus",
  "layout",
  "sequenceOverride",
  "diagramNode",
  "gotoBeat",
] as const satisfies readonly RevisionedMessage["type"][];
export const DIAGRAM_MESSAGE_TYPES = [
  "diagramOpen",
  "diagramRequest",
  "diagramFeedback",
  "diagramPin",
  "diagramExpand",
  "detourReturn",
  "diagramSettings",
  "panelFollow",
] as const satisfies readonly DiagramMessage["type"][];

/** The bridge adds the revision before sending. */
export type SidebarRequest =
  | Omit<NavigateMessage, "revision">
  | Omit<StateMessage, "revision">
  | Omit<FocusMessage, "revision">
  | DistributiveOmit<LayoutMessage, "revision">
  | Omit<SequenceOverrideMessage, "revision">
  | Omit<DiagramNodeMessage, "revision">
  | Omit<GotoBeatMessage, "revision">
  | DiagramMessage
  | { type: "quickPick" }
  | { type: "clear" };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
