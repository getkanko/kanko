// Generated from TypeScript. Run npm run runtime:build in editor-extension.
import type { SourceReader, TourStop } from "./types.js";
import type { DiagramKind } from "./diagram.js";
export type DrawSignalCode =
  "branches" | "call_path" | "states" | "value_flow" | "timing";
export type SkipSignalCode =
  "formatting_only" | "one_line" | "config_only" | "tests_only" | "budget";
export interface DiagramSignals {
  stopId: string;
  draw: {
    code: DrawSignalCode;
    kind: DiagramKind;
    detail: string;
  }[];
  skip: {
    code: SkipSignalCode;
    detail: string;
  }[];
  recommendation: "draw" | "skip";
  /** The first matching kind, in the order of the spec's kind table. */
  suggestedKind: DiagramKind | null;
  changedLines: number;
}
export interface SignalOptions {
  /** Active automatic diagrams already on this stop. */
  existingDiagrams?: number;
  maxPerStop?: number;
}
export declare function computeDiagramSignals(
  stop: Pick<TourStop, "id" | "anchors">,
  readSource: SourceReader,
  options?: SignalOptions,
): DiagramSignals;
