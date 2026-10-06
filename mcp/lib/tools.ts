import type { MapRequests } from "./review-map/types.js";
type ToolService = {
  [K in Exclude<keyof MapRequests, "diagramPut">]: (
    args: MapRequests[K],
  ) => K extends "loadTour" | "diagramSkip" | "diagramPin" | "diagramFeedback"
    ? Record<string, unknown>
    : unknown;
} & {
  diagramPut(
    args: MapRequests["diagramPut"],
    options?: { id?: string },
  ): Record<string, unknown> & { diagram: unknown };
};
import type { BridgeLock } from "./discovery.js";
import { isRecord } from "./input.js";
import { readMapRequest } from "./review-map/readers.js";

import { request } from "./bridge.js";
import { ReviewMapService } from "./review-map/service.js";
import { errorFields } from "./input.js";
import { readDiagramSettings } from "../../shared/diagram.js";
import type { DiagramSettings } from "../../shared/diagram.js";
import { validateDiagram } from "../../shared/diagram-validate.js";
import tourSchema = require("../../schemas/tour-plan.schema.json");
import diagramSchema = require("../../schemas/diagram.schema.json");

// Embed schema references so clients need no extra files.
function inlineSchema(
  value: unknown,
  definitions: Record<string, unknown>,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => inlineSchema(item, definitions));
  if (!isRecord(value)) return value;
  if (typeof value.$ref === "string") {
    const target = definitions[value.$ref.split("/").at(-1) || ""];
    const { $ref: _, ...rest } = value;
    return {
      ...(inlineSchema(target, definitions) as object),
      ...(inlineSchema(rest, definitions) as object),
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      inlineSchema(child, definitions),
    ]),
  );
}
const inlineTourSchema = (value: unknown) =>
  inlineSchema(value, tourSchema.$defs);
const { $schema: _schema, $id: _id, $defs, ...diagramBody } = diagramSchema;
const DIAGRAM = inlineSchema(diagramBody, $defs);

const WORKSPACE = {
  type: "string",
  description:
    "Absolute path to the repository root being toured. Resolve it with git rev-parse --show-toplevel.",
};

const BRIDGE_TOOLS = [
  {
    name: "kanko_tour_status",
    description: "Read the editor's current tour snapshot without changing it.",
    inputSchema: {
      type: "object",
      required: ["workspace"],
      properties: { workspace: WORKSPACE },
    },
  },
  {
    name: "kanko_tour_load",
    description:
      "Validate and load the current authored tour from the review map into the editor. Returns findings, the current stop/beat, and terminal narration. Invalid tours leave the current display unchanged.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId"],
      properties: { workspace: WORKSPACE, mapId: { type: "string" } },
    },
  },
  {
    name: "kanko_tour_navigate",
    description:
      "Navigate the loaded tour by stop or beat. Use goto with stopId and beatId for an exact destination. Presentation changes do not mark review map claims or stops reviewed.",
    inputSchema: {
      type: "object",
      required: ["workspace", "action"],
      properties: {
        workspace: WORKSPACE,
        action: {
          enum: [
            "nextBeat",
            "previousBeat",
            "nextStop",
            "previousStop",
            "goto",
          ],
        },
        stopId: { type: "string" },
        beatId: { type: "string" },
        expectedRevision: { type: "integer", minimum: 0 },
      },
    },
  },
  {
    name: "kanko_tour_set_state",
    description:
      "Set following, exploring, or paused presentation mode for the loaded tour. Following reveals the selected anchor; exploring leaves the editor in place; paused removes presentation highlights.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mode"],
      properties: {
        workspace: WORKSPACE,
        mode: { enum: ["following", "exploring", "paused"] },
        expectedRevision: { type: "integer", minimum: 0 },
      },
    },
  },
  {
    name: "kanko_tour_clear",
    description:
      "End the current presentation and clear its sidebar and highlights. Does not complete the review session.",
    inputSchema: {
      type: "object",
      required: ["workspace"],
      properties: { workspace: WORKSPACE },
    },
  },
];

const ACTOR = {
  type: "object",
  required: ["kind", "id"],
  properties: {
    kind: {
      type: "string",
      description: "Actor class, for example agent or reviewer.",
    },
    id: {
      type: "string",
      description: "Stable actor identifier within this review context.",
    },
    displayName: { type: "string" },
  },
};

const SELECTION = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "base", "head"],
      properties: {
        kind: { const: "committed" },
        base: { type: "string" },
        head: { type: "string" },
        diffMode: { type: "string", enum: ["two-dot", "three-dot"] },
      },
    },
    {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { const: "working-tree" },
        baseline: { type: "string" },
        includeStaged: { type: "boolean" },
        includeUnstaged: { type: "boolean" },
        includeUntracked: { type: "boolean" },
      },
    },
  ],
};

const MAP_ID = { type: "string", pattern: "^map_[0-9a-f-]+$" };
const EXPECTED_REVISION = {
  type: "integer",
  minimum: 1,
  description:
    "Aggregate revision returned by the latest review map call. Prevents stale writers.",
};
const ENTITY_INPUT = {
  type: "object",
  description:
    "Typed entity fields plus a non-empty provenance array. The service assigns identity and audit fields.",
};
function command(
  type: string,
  required: string[] = [],
  properties: Record<string, unknown> = {},
) {
  return {
    type: "object",
    required: ["type", ...required],
    properties: { type: { const: type }, ...properties },
  };
}
const COMMAND = {
  oneOf: [
    command("SetThesis", ["thesis"], { thesis: ENTITY_INPUT }),
    ...[
      "Requirement",
      "Claim",
      "Decision",
      "Assumption",
      "Invariant",
      "Risk",
      "Evidence",
      "CodeReference",
    ].map((noun) =>
      command(`Add${noun}`, [noun[0].toLowerCase() + noun.slice(1)], {
        [noun[0].toLowerCase() + noun.slice(1)]: ENTITY_INPUT,
      }),
    ),
    command("AddRelationship", ["relationship"], {
      relationship: ENTITY_INPUT,
    }),
    command("CreateTourPlan", ["presentationVersion", "stops"], {
      title: { type: "string" },
      presentationVersion: { const: 2 },
      stops: {
        type: "array",
        minItems: 1,
        items: inlineTourSchema(tourSchema.$defs.stop),
      },
    }),
    command("MarkPrepared"),
    command("StartReviewSession", [], {
      reviewer: ACTOR,
      sessionId: { type: "string" },
    }),
    command("StartStop", ["sessionId", "stopId"], {
      sessionId: { type: "string" },
      stopId: { type: "string" },
    }),
    command("RecordQuestion", ["question"], { question: ENTITY_INPUT }),
    command("RecordConcern", ["concern"], { concern: ENTITY_INPUT }),
    command("RecordAnswer", ["questionId", "answer", "provenance"], {
      questionId: { type: "string" },
      answer: { type: "string" },
      provenance: { type: "array", minItems: 1 },
      disposition: { type: "string" },
    }),
    command("SetClaimDisposition", ["claimId", "disposition"], {
      claimId: { type: "string" },
      disposition: { type: "string" },
      rationale: { type: "string" },
    }),
    command("SetRiskDisposition", ["riskId", "disposition"], {
      riskId: { type: "string" },
      disposition: { type: "string" },
      rationale: { type: "string" },
    }),
    command("SetStopReviewState", ["sessionId", "stopId", "reviewState"], {
      sessionId: { type: "string" },
      stopId: { type: "string" },
      reviewState: { type: "string" },
      note: { type: "string" },
    }),
    ...["PauseReviewSession", "ResumeReviewSession"].map((type) =>
      command(type, ["sessionId"], { sessionId: { type: "string" } }),
    ),
    command("CompleteReviewSession", ["sessionId", "outcome"], {
      sessionId: { type: "string" },
      outcome: {
        type: "string",
        enum: [
          "ready-to-approve",
          "changes-requested",
          "deferred",
          "informational-only",
        ],
      },
    }),
    command("CorrectEntity", ["entityId", "changes", "provenance"], {
      entityId: { type: "string" },
      changes: { type: "object" },
      provenance: { type: "array", minItems: 1 },
    }),
    command("ArchiveReviewMap"),
  ],
};

const MAP_TOOLS = [
  {
    name: "kanko_map_open",
    description:
      "Resolve an exact Git change identity and open its local review map, or create a private draft outside the repository. Does not run tests, fetch remotes, or modify source.",
    inputSchema: {
      type: "object",
      required: ["workspace", "selection", "actor"],
      properties: {
        workspace: WORKSPACE,
        selection: SELECTION,
        actor: ACTOR,
        title: { type: "string" },
        createIfMissing: { type: "boolean", default: true },
        forceNew: {
          type: "boolean",
          default: false,
          description:
            "Create a separate review map even when the exact change or a related lineage already has one. Use only after confirming the existing review map belongs to another task.",
        },
      },
    },
  },
  {
    name: "kanko_map_get",
    description:
      "Read a bounded review map projection. Use overview first, then request only the entity, tour, recap, open items, evidence matrix, or storage location needed.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId", "selector"],
      properties: {
        workspace: WORKSPACE,
        mapId: MAP_ID,
        selector: {
          type: "object",
          required: ["kind"],
          properties: {
            kind: {
              type: "string",
              enum: [
                "overview",
                "entity",
                "entities",
                "tour",
                "open-items",
                "evidence-matrix",
                "recap",
                "storage",
              ],
            },
            id: { type: "string" },
            type: { type: "string" },
            stopId: { type: "string" },
            sessionId: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "kanko_map_apply",
    description:
      "Atomically apply typed review map domain commands. Never submit JSON Patch or a rewritten review map. Important statements require structured provenance; review mutations are rejected if code drifted.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId", "expectedRevision", "actor", "commands"],
      properties: {
        workspace: WORKSPACE,
        mapId: MAP_ID,
        expectedRevision: EXPECTED_REVISION,
        actor: ACTOR,
        commands: { type: "array", minItems: 1, items: COMMAND },
      },
    },
  },
  {
    name: "kanko_map_check",
    description:
      "Check review map event integrity, schema version, and exact Git freshness without changing state.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId"],
      properties: { workspace: WORKSPACE, mapId: MAP_ID },
    },
  },
  {
    name: "kanko_map_refresh",
    description:
      "Record a new exact change revision after drift and conservatively invalidate reviewed stops and evidence. Earlier review history is preserved.",
    inputSchema: {
      type: "object",
      required: [
        "workspace",
        "mapId",
        "expectedRevision",
        "selection",
        "actor",
      ],
      properties: {
        workspace: WORKSPACE,
        mapId: MAP_ID,
        expectedRevision: EXPECTED_REVISION,
        selection: SELECTION,
        actor: ACTOR,
      },
    },
  },
  {
    name: "kanko_map_receipt",
    description:
      "Preview or emit a deterministic review receipt tied to the exact current change. Emit writes immutable JSON and Markdown locally; it never publishes remotely.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId", "sessionId", "mode", "actor"],
      properties: {
        workspace: WORKSPACE,
        mapId: MAP_ID,
        sessionId: { type: "string" },
        mode: { type: "string", enum: ["preview", "emit"] },
        expectedRevision: EXPECTED_REVISION,
        supersedesReceiptId: { type: "string" },
        actor: ACTOR,
      },
      allOf: [
        {
          if: { properties: { mode: { const: "emit" } } },
          then: { required: ["expectedRevision"] },
        },
      ],
    },
  },
  {
    name: "kanko_map_delete",
    description:
      "Permanently delete one local review map and all of its receipts and evidence. Requires the review map ID repeated as explicit confirmation and never touches repository source.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId", "confirmMapId", "actor"],
      properties: {
        workspace: WORKSPACE,
        mapId: MAP_ID,
        confirmMapId: MAP_ID,
        actor: ACTOR,
      },
    },
  },
];

const MAP_ID_ARG = { type: "string", pattern: "^map_[0-9a-f-]+$" };
const DIAGRAM_TOOLS = [
  {
    name: "kanko_diagram_put",
    description:
      "Validate a diagram against the review map's pinned sources, store it on its stop, and show it in the editor when a tour is loaded. Rejected when kanko.diagrams.mode forbids it, an automatic diagram exceeds maxPerStop, a derived node lacks an anchor, an anchor does not resolve, or the graph exceeds 40 nodes.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId", "diagram"],
      properties: { workspace: WORKSPACE, mapId: MAP_ID_ARG, diagram: DIAGRAM },
    },
  },
  {
    name: "kanko_diagram_skip",
    description:
      "Record that a stop gets no automatic diagram, with one plain sentence about the change (for example, adds 2 counters and no new control flow). The tour map shows the reason and offers Draw one anyway.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId", "stopId", "reason"],
      properties: {
        workspace: WORKSPACE,
        mapId: MAP_ID_ARG,
        stopId: { type: "string" },
        reason: { type: "string", maxLength: 300 },
      },
    },
  },
  {
    name: "kanko_diagram_stream",
    description:
      "Stream a diagram into a detour while answering a reviewer request. Each patch merges metadata and upserts nodes, edges, and lanes by id; send the axis and early nodes first. Unresolved edge endpoints render as placeholders. final: true validates the complete diagram, stores it as requested on its stop (unpinned), and shows its provenance.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId", "detourId", "diagramId", "patch"],
      properties: {
        workspace: WORKSPACE,
        mapId: MAP_ID_ARG,
        detourId: {
          type: "string",
          description:
            "The diagram_request id, or a new id for a question asked in the conversation.",
        },
        diagramId: { type: "string", pattern: "^[\\w.:-]{1,64}$" },
        patch: {
          type: "object",
          description:
            "Any diagram fields plus optional status (a short progress line), question (the reviewer's words), and answer (your plain-text reply). after/before may hold partial nodes, edges, lanes, and axis.",
        },
        final: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "kanko_diagram_pin",
    description:
      "Pin a requested diagram to a stop so future reviewers see it there. The reviewer usually pins from the editor; use this only when the reviewer asks you to.",
    inputSchema: {
      type: "object",
      required: ["workspace", "mapId", "diagramId", "stopId"],
      properties: {
        workspace: WORKSPACE,
        mapId: MAP_ID_ARG,
        diagramId: { type: "string" },
        stopId: { type: "string" },
      },
    },
  },
  {
    name: "kanko_await_reviewer",
    description:
      "Collect reviewer events from the editor: diagram_request (Draw one anyway or Redraw; answer with kanko_diagram_stream), diagram_feedback (Not helpful; do not redraw that stop), and diagram_pinned (already saved to the review map). Waits up to timeoutMs for the first event; 0 returns immediately.",
    inputSchema: {
      type: "object",
      required: ["workspace"],
      properties: {
        workspace: WORKSPACE,
        timeoutMs: { type: "integer", minimum: 0, maximum: 60000, default: 0 },
      },
    },
  },
];

const TOOLS = [...BRIDGE_TOOLS, ...MAP_TOOLS, ...DIAGRAM_TOOLS];
const REVIEWER: { kind: string; id: string } = {
  kind: "reviewer",
  id: "editor",
};

interface StreamDraft {
  mapId: string;
  detourId: string;
  diagram: Record<string, unknown>;
}
const object = (value: unknown) => (isRecord(value) ? value : {});

/** Merge a stream patch: metadata replaces, graph items upsert by id. */
function mergePatch(
  draft: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const next = { ...draft };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "after" || key === "before") {
      const graph: Record<string, unknown> = {
        nodes: [],
        edges: [],
        ...object(next[key]),
      };
      const incoming = object(value);
      for (const list of ["nodes", "edges", "lanes"] as const) {
        if (!Array.isArray(incoming[list])) continue;
        const items: unknown[] = Array.isArray(graph[list])
          ? [...(graph[list] as unknown[])]
          : [];
        for (const item of incoming[list] as unknown[]) {
          const id = isRecord(item) ? item.id : undefined;
          const at = items.findIndex((x) => isRecord(x) && x.id === id);
          if (at >= 0) items[at] = item;
          else items.push(item);
        }
        Object.assign(graph, { [list]: items });
      }
      if (incoming.axis !== undefined)
        Object.assign(graph, { axis: incoming.axis });
      next[key] = graph;
    } else next[key] = value;
  }
  return next;
}

const ROUTES: Record<string, [string, string]> = {
  kanko_tour_status: ["GET", "/status"],
  kanko_tour_load: ["POST", "/tour/load"],
  kanko_tour_navigate: ["POST", "/tour/navigate"],
  kanko_tour_set_state: ["POST", "/tour/state"],
  kanko_tour_clear: ["POST", "/clear"],
};

function createCallTool({
  resolveLock,
  mapService = new ReviewMapService(),
}: {
  resolveLock: (
    workspace: string | undefined,
  ) => Pick<BridgeLock, "port" | "authToken">;
  mapService?: ToolService;
}) {
  const streams = new Map<string, StreamDraft>();
  const workspaceOf = (args: Record<string, unknown>) => {
    if (typeof args.workspace !== "string")
      throw Object.assign(new Error("workspace must be a string"), {
        code: "bad_request",
      });
    return args.workspace;
  };
  // Editor settings decide when diagrams are allowed; without an editor the
  // documented defaults apply.
  async function editorState(workspace: string) {
    try {
      const status = await request(
        resolveLock(workspace),
        "GET",
        "/status",
        {},
      );
      return {
        settings: readDiagramSettings(status.diagramSettings),
        snapshot: isRecord(status.snapshot) ? status.snapshot : null,
      };
    } catch {
      return { settings: readDiagramSettings(undefined), snapshot: null };
    }
  }
  // Showing a stored diagram is best effort: the review map is the record.
  async function show(
    workspace: string,
    route: string,
    body: Record<string, unknown>,
  ) {
    try {
      await request(resolveLock(workspace), "POST", route, {
        ...body,
        workspace,
      });
      return { shown: true };
    } catch (error) {
      return { shown: false, editor: errorFields(error).message };
    }
  }
  async function diagramTool(name: string, args: Record<string, unknown>) {
    const workspace = workspaceOf(args);
    if (name === "kanko_await_reviewer") {
      const timeoutMs =
        typeof args.timeoutMs === "number"
          ? Math.max(0, Math.min(60000, args.timeoutMs))
          : 0;
      const result = await request(
        resolveLock(workspace),
        "POST",
        "/reviewer/await",
        {
          workspace,
          timeoutMs,
        },
      );
      const events = Array.isArray(result.events) ? result.events : [];
      const delivered = [];
      for (const event of events) {
        if (!isRecord(event)) continue;
        const mapId = typeof event.mapId === "string" ? event.mapId : "";
        try {
          if (event.kind === "diagram_pin") {
            mapService.diagramPin(
              readMapRequest("diagramPin", {
                workspace,
                mapId,
                diagramId: event.diagramId,
                stopId: event.stopId,
                actor: REVIEWER,
              }),
            );
            delivered.push({ ...event, kind: "diagram_pinned" });
            continue;
          }
          if (event.kind === "diagram_feedback")
            mapService.diagramFeedback(
              readMapRequest("diagramFeedback", {
                workspace,
                mapId,
                diagramId: event.diagramId,
                value: event.value,
                actor: REVIEWER,
              }),
            );
          delivered.push(event);
        } catch (error) {
          delivered.push({
            ...event,
            persistError: errorFields(error).message,
          });
        }
      }
      return { events: delivered };
    }
    const { settings, snapshot } = await editorState(workspace);
    const withSettings = { ...args, settings };
    if (name === "kanko_diagram_put") {
      const result = mapService.diagramPut(
        readMapRequest("diagramPut", withSettings),
      );
      return {
        ...result,
        ...(await show(workspace, "/diagram/put", {
          tourId: args.mapId,
          diagram: result.diagram,
        })),
      };
    }
    if (name === "kanko_diagram_skip") {
      const result = mapService.diagramSkip(
        readMapRequest("diagramSkip", withSettings),
      );
      return {
        ...result,
        ...(await show(workspace, "/diagram/skip", {
          tourId: args.mapId,
          skip: result.skip,
        })),
      };
    }
    if (name === "kanko_diagram_pin") {
      const result = mapService.diagramPin(readMapRequest("diagramPin", args));
      return {
        ...result,
        ...(await show(workspace, "/diagram/pin", {
          tourId: args.mapId,
          diagramId: args.diagramId,
          stopId: args.stopId,
        })),
      };
    }
    // kanko_diagram_stream
    if (
      typeof args.mapId !== "string" ||
      typeof args.detourId !== "string" ||
      typeof args.diagramId !== "string" ||
      !/^[\w.:-]{1,64}$/.test(args.diagramId) ||
      !isRecord(args.patch)
    )
      throw Object.assign(
        new Error(
          "stream requires mapId, detourId, diagramId, and a patch object",
        ),
        { code: "bad_request" },
      );
    if (settings.mode === "off")
      throw Object.assign(
        new Error(
          "Diagrams are turned off in kanko.diagrams.mode. Answer in text and add one line saying diagrams are off.",
        ),
        { code: "diagrams_off" },
      );
    const key = `${args.mapId}:${args.diagramId}`;
    const previous = streams.get(key);
    const { status, question, answer, ...patch } = args.patch;
    const stop = isRecord(snapshot?.stop) ? snapshot.stop.id : undefined;
    const diagram = mergePatch(
      previous?.diagram || {
        origin: "requested",
        detourId: args.detourId,
        ...(typeof stop === "string" ? { stopId: stop } : {}),
      },
      patch,
    );
    const draft = { mapId: args.mapId, detourId: args.detourId, diagram };
    const text = {
      ...(typeof status === "string" ? { status } : {}),
      ...(typeof question === "string" ? { question } : {}),
      ...(typeof answer === "string" ? { answer } : {}),
    };
    if (args.final !== true) {
      const partial = validateDiagram(diagram, { partial: true });
      if (!partial.ok)
        throw Object.assign(
          new Error("Fix the streamed diagram's structure."),
          {
            code: "invalid_diagram",
            details: { findings: partial.findings },
          },
        );
      streams.set(key, draft);
      return {
        ok: true,
        final: false,
        ...(await show(workspace, "/diagram/stream", {
          tourId: args.mapId,
          detourId: args.detourId,
          diagramId: args.diagramId,
          draft: diagram,
          ...text,
          final: false,
        })),
      };
    }
    const result = mapService.diagramPut(
      readMapRequest("diagramPut", {
        workspace,
        mapId: args.mapId,
        diagram: { ...diagram, detourId: args.detourId },
        settings: settings as DiagramSettings,
      }),
      { id: args.diagramId },
    );
    streams.delete(key);
    return {
      ...result,
      final: true,
      ...(await show(workspace, "/diagram/stream", {
        tourId: args.mapId,
        detourId: args.detourId,
        diagramId: args.diagramId,
        diagram: result.diagram,
        ...text,
        final: true,
      })),
    };
  }
  return async function callTool(name: string, args: Record<string, unknown>) {
    if (name.startsWith("kanko_diagram_") || name === "kanko_await_reviewer")
      return diagramTool(name, args);
    if (name === "kanko_map_open")
      return mapService.open(readMapRequest("open", args));
    if (name === "kanko_map_get")
      return mapService.get(readMapRequest("get", args));
    if (name === "kanko_map_apply")
      return mapService.apply(readMapRequest("apply", args));
    if (name === "kanko_map_check")
      return mapService.check(readMapRequest("check", args));
    if (name === "kanko_map_refresh")
      return mapService.refresh(readMapRequest("refresh", args));
    if (name === "kanko_map_receipt")
      return mapService.receipt(readMapRequest("receipt", args));
    if (name === "kanko_map_delete")
      return mapService.delete(readMapRequest("delete", args));
    const route = ROUTES[name];
    if (!route) throw new Error(`unknown tool: ${name}`);
    const { workspace, ...bridgeArgs } = args;
    const payload =
      name === "kanko_tour_load"
        ? mapService.loadTour(readMapRequest("loadTour", args))
        : { ...bridgeArgs, workspace };
    if (workspace !== undefined && typeof workspace !== "string")
      throw new Error("workspace must be a string");
    const lock = resolveLock(workspace);
    return request(lock, route[0], route[1], payload);
  };
}

export {
  TOOLS,
  BRIDGE_TOOLS,
  MAP_TOOLS,
  DIAGRAM_TOOLS,
  ROUTES,
  createCallTool,
  mergePatch,
};
