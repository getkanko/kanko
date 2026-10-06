// Generated from TypeScript. Run npm run runtime:build in editor-extension.
import type {
  ClaimSummary,
  ContentHash,
  Revisions,
  SourceReader,
  TourStop,
} from "./types.js";
import type { Diagram, DiagramInput } from "./diagram.js";
export type DiagramFindingCode =
  | "invalid_diagram"
  | "invalid_kind"
  | "invalid_title"
  | "unknown_stop"
  | "invalid_origin"
  | "missing_reason"
  | "invalid_provenance"
  | "derived_only"
  | "invalid_revision"
  | "invalid_graph"
  | "size_limit"
  | "invalid_node"
  | "duplicate_id"
  | "invalid_edge"
  | "unknown_beat"
  | "unknown_claim"
  | "invalid_lane"
  | "invalid_axis"
  | "invalid_span"
  | "unanchored_node"
  | "invalid_anchor"
  | "anchor_unresolved"
  | "beat_node_budget"
  | "small_diagram"
  | "beat_anchor_mismatch";
export interface DiagramFinding {
  severity: "error" | "warning";
  code: DiagramFindingCode;
  location: string;
  message: string;
}
export interface DiagramValidateOptions {
  readSource?: SourceReader;
  revisions?: Revisions;
  /** Stops of the current plan; diagram stops and beat ids must exist. */
  stops?: Pick<TourStop, "id" | "beats" | "anchors">[];
  claims?: Pick<ClaimSummary, "id">[];
  derivedOnly?: boolean;
  /** Streams check structure before every anchor has arrived. */
  partial?: boolean;
}
export type DiagramValidation =
  | {
      ok: true;
      diagram: DiagramInput;
      findings: DiagramFinding[];
    }
  | {
      ok: false;
      diagram: null;
      findings: DiagramFinding[];
    };
/** Hash of every anchored range; independent of revision ids, so unchanged
 * code at a new head stays current. */
export declare function diagramSourceHash(
  diagram: Pick<Diagram, "before" | "after">,
): ContentHash;
/** Whether any anchored range no longer matches the given sources. */
export declare function diagramIsStale(
  diagram: Pick<Diagram, "before" | "after" | "sourceHash">,
  readSource: SourceReader,
  revisions: Revisions,
): boolean;
export declare function validateDiagram(
  input: unknown,
  options?: DiagramValidateOptions,
): DiagramValidation;
export declare function hasDiagramErrors(findings: DiagramFinding[]): boolean;
