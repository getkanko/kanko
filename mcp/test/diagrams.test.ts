import { test, type TestContext } from "node:test";
import * as assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { errorFields } from "../../generated/mcp/lib/input.js";
import { ReviewMapService } from "../../generated/mcp/lib/review-map/service.js";
import { createCallTool } from "../../generated/mcp/lib/tools.js";
import { validateEvent } from "../../generated/mcp/lib/review-map/validation.js";
import { hashText, rangeText } from "../../generated/shared/tour.js";
import { findings, record, records } from "../../test/assertions.js";
import { actor, paymentsFixture } from "../../test/diagram-fixture.js";

const fixture = (t: TestContext) => paymentsFixture((fn) => t.after(fn));
const auto = {
  mode: "auto" as const,
  maxPerStop: 1,
  derivedOnly: false,
  openBeside: "ask" as const,
};
const code = (error: unknown) => errorFields(error).code;

test("in auto mode K02 gets a flow diagram and K05 a recorded skip, each with a reason", (t) => {
  const f = fixture(t);
  const signals = records(f.applied.diagramSignals);
  assert.deepEqual(
    signals.map((s) => [s.stopId, s.recommendation]),
    [
      ["K02", "draw"],
      ["K03", "draw"],
      ["K05", "skip"],
    ],
  );
  const put = f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: f.k02Diagram(),
    settings: auto,
  });
  assert.match(String(put.diagramId), /^dgm_/);
  f.service.diagramSkip({
    workspace: f.workspace,
    mapId: f.mapId,
    stopId: "K05",
    reason: "Adds 2 counters and no new control flow.",
  });
  const load = f.service.loadTour({ workspace: f.workspace, mapId: f.mapId });
  const items = records(load.diagrams.items);
  assert.deepEqual(
    items.map((d) => [d.stopId, d.kind, d.reason, d.stale]),
    [["K02", "flow", "The stop adds 3 branches to one function.", false]],
  );
  assert.deepEqual(
    load.diagrams.skips.map((s) => [s.stopId, s.reason]),
    [["K05", "Adds 2 counters and no new control flow."]],
  );
  // A restarted service replays the same dossier from validated events.
  const restarted = new ReviewMapService({ root: `${f.root}/state` });
  const again = restarted.get({
    workspace: f.workspace,
    mapId: f.mapId,
    selector: { kind: "diagrams" },
  });
  assert.deepEqual(record(again).items, load.diagrams.items);
});

test("the per-stop budget limits automatic diagrams; a redraw replaces its original", (t) => {
  const f = fixture(t);
  const args = { workspace: f.workspace, mapId: f.mapId, settings: auto };
  const first = f.service.diagramPut({ ...args, diagram: f.k02Diagram() });
  assert.throws(
    () => f.service.diagramPut({ ...args, diagram: f.k02Diagram() }),
    (e) => code(e) === "diagram_budget",
  );
  f.service.diagramPut({
    ...args,
    diagram: f.k02Diagram({ origin: "requested", pinned: true }),
  });
  const redraw = f.service.diagramPut({
    ...args,
    diagram: f.k02Diagram({ replaces: first.diagramId }),
  });
  const ids = f.service
    .diagramProjection(f.service.locate(f.workspace, f.mapId).state)
    .items.map((d) => d.id);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes(redraw.diagramId) && !ids.includes(first.diagramId));
  assert.throws(
    () =>
      f.service.diagramPut({
        ...args,
        diagram: f.k02Diagram({ replaces: first.diagramId }),
      }),
    (e) => code(e) === "diagram_not_found",
  );
  // Requested diagrams never count against the budget.
  f.service.diagramPut({
    ...args,
    settings: { ...auto, maxPerStop: 0 },
    diagram: f.k02Diagram({ origin: "requested" }),
  });
});

test("a derived diagram with an unanchored node is rejected with findings", (t) => {
  const f = fixture(t);
  const diagram = f.k02Diagram();
  delete diagram.after.nodes[5].anchor;
  assert.throws(
    () =>
      f.service.diagramPut({
        workspace: f.workspace,
        mapId: f.mapId,
        diagram,
        settings: auto,
      }),
    (e) =>
      code(e) === "invalid_diagram" &&
      findings(e).some((x) => x.code === "unanchored_node"),
  );
  assert.equal(
    f.service.locate(f.workspace, f.mapId).state.diagrams,
    undefined,
  );
});

test("modes: off rejects everything, onRequest rejects only automatic diagrams, derivedOnly blocks sketches", (t) => {
  const f = fixture(t);
  const args = { workspace: f.workspace, mapId: f.mapId };
  assert.throws(
    () =>
      f.service.diagramPut({
        ...args,
        diagram: f.k02Diagram(),
        settings: { ...auto, mode: "off" },
      }),
    (e) => code(e) === "diagrams_off",
  );
  assert.throws(
    () =>
      f.service.diagramPut({
        ...args,
        diagram: f.k02Diagram(),
        settings: { ...auto, mode: "onRequest" },
      }),
    (e) => code(e) === "diagrams_on_request",
  );
  f.service.diagramPut({
    ...args,
    diagram: f.k02Diagram({ origin: "requested" }),
    settings: { ...auto, mode: "onRequest" },
  });
  const sketch = f.k02Diagram({
    provenance: {
      status: "inferred",
      method: "agent-sketch",
      sources: [],
      revs: { after: f.head },
    },
  });
  delete sketch.before;
  assert.throws(
    () =>
      f.service.diagramPut({
        ...args,
        diagram: sketch,
        settings: { ...auto, derivedOnly: true },
      }),
    (e) => findings(e).some((x) => x.code === "derived_only"),
  );
});

test("requested diagrams appear on the stop only once pinned, and pinning persists", (t) => {
  const f = fixture(t);
  const args = { workspace: f.workspace, mapId: f.mapId };
  const put = f.service.diagramPut({
    ...args,
    diagram: { ...f.k03Timeline(), detourId: "req_1" },
    settings: auto,
  });
  const projection = () =>
    f.service.get({ ...args, selector: { kind: "diagrams" } });
  assert.deepEqual(record(projection()).items, []);
  f.service.diagramPin({
    ...args,
    diagramId: put.diagramId,
    stopId: "K03",
    actor: { kind: "reviewer", id: "editor" },
  });
  const restarted = new ReviewMapService({ root: `${f.root}/state` });
  const items = records(
    record(restarted.get({ ...args, selector: { kind: "diagrams" } })).items,
  );
  assert.deepEqual(
    items.map((d) => [d.id, d.stopId, d.pinned, d.origin, d.detourId]),
    [[put.diagramId, "K03", true, "requested", "req_1"]],
  );
  assert.throws(
    () =>
      f.service.diagramPin({
        ...args,
        diagramId: "dgm_missing",
        stopId: "K03",
      }),
    (e) => code(e) === "diagram_not_found",
  );
  f.service.diagramFeedback({
    ...args,
    diagramId: put.diagramId,
    value: "not_helpful",
  });
  assert.equal(records(record(projection()).items)[0].feedback, "not_helpful");
});

test("after a new commit changes classify.go the K02 diagram loads stale", (t) => {
  const f = fixture(t);
  f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: f.k02Diagram(),
    settings: auto,
  });
  f.write(
    "payments/retry/classify.go",
    f.texts.CLASSIFY_HEAD.replace("return RetrySameKey", "return RetryWithKey"),
  );
  f.git("commit", "-qam", "rename decision");
  const head = f.git("rev-parse", "HEAD");
  let state = f.service.locate(f.workspace, f.mapId).state;
  f.service.refresh({
    workspace: f.workspace,
    mapId: f.mapId,
    expectedRevision: state.aggregateRevision,
    selection: { kind: "committed", base: f.base, head },
    actor,
  });
  // Regenerate the tour's anchors for the new head, as the skill requires.
  state = f.service.locate(f.workspace, f.mapId).state;
  const plan = state.tourPlans[state.currentTourPlanId || ""];
  const text = (path: string) => f.git("show", `${head}:${path}`) + "\n";
  const stops = plan.stops.map(({ id, title, risk, type, anchors, beats }) => ({
    id,
    title,
    risk,
    type,
    beats,
    anchors: anchors.map((a) => ({
      ...a,
      rev: { base: f.base, head },
      contentHash: hashText(rangeText(text(a.path), a.context) || ""),
    })),
  }));
  f.service.apply({
    workspace: f.workspace,
    mapId: f.mapId,
    expectedRevision: state.aggregateRevision,
    actor,
    commands: [{ type: "CreateTourPlan", presentationVersion: 2, stops }],
  });
  const load = f.service.loadTour({ workspace: f.workspace, mapId: f.mapId });
  assert.deepEqual(
    records(load.diagrams.items).map((d) => [d.stopId, d.stale]),
    [["K02", true]],
  );
});

test("a plan that renames beats drops their links and marks the drawing stale", (t) => {
  const f = fixture(t);
  f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: f.k02Diagram(),
    settings: auto,
  });
  const state = f.service.locate(f.workspace, f.mapId).state;
  const plan = state.tourPlans[state.currentTourPlanId || ""];
  const stops = plan.stops.map(({ id, title, risk, type, anchors, beats }) => ({
    id,
    title,
    risk,
    type,
    anchors,
    beats: beats.map((b) => (b.id === "key" ? { ...b, id: "keyed" } : b)),
  }));
  f.service.apply({
    workspace: f.workspace,
    mapId: f.mapId,
    expectedRevision: state.aggregateRevision,
    actor,
    commands: [{ type: "CreateTourPlan", presentationVersion: 2, stops }],
  });
  const [item] = records(
    f.service.loadTour({ workspace: f.workspace, mapId: f.mapId }).diagrams
      .items,
  );
  assert.equal(item.stale, true);
  const key = records(record(item.after).nodes).find(
    (n) => n.id === "decide#key",
  );
  assert.deepEqual(key?.beatIds, []);
});

test("stored diagram events are checked before replay", (t) => {
  const f = fixture(t);
  f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: f.k02Diagram(),
    settings: auto,
  });
  const event = {
    schemaVersion: 2,
    mapId: f.mapId,
    sequence: 9,
    eventId: "evt_1",
    eventType: "DiagramAdded",
    occurredAt: "2026-10-05T00:00:00.000Z",
    actor,
    changeRevisionId: null,
    expectedAggregateRevision: 8,
    previousEventHash: null,
    eventHash: hashText("x"),
    payload: { diagram: { id: "d", kind: "flow" } },
  };
  assert.throws(
    () => validateEvent(event),
    (e) => code(e) === "event_schema_invalid",
  );
});

async function fakeEditor(
  t: TestContext,
  routes: Record<string, (body: Record<string, unknown>) => unknown>,
) {
  const seen: [string, Record<string, unknown>][] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      const route = `${req.method} ${(req.url || "").split("?")[0]}`;
      seen.push([route, parsed]);
      const handler = routes[route];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          handler
            ? { ok: true, ...(handler(parsed) as object) }
            : {
                ok: false,
                error: { code: "no_tour", message: "Load a tour first." },
              },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return {
    seen,
    lock: { port: (server.address() as AddressInfo).port, authToken: "token" },
  };
}

test("tools read editor settings, store diagrams, and show them in the editor", async (t) => {
  const f = fixture(t);
  const editor = await fakeEditor(t, {
    "GET /status": () => ({
      diagramSettings: { ...auto, mode: "onRequest" },
      snapshot: { loaded: true, stop: { id: "K03" } },
    }),
    "POST /diagram/put": () => ({}),
    "POST /diagram/stream": () => ({}),
    "POST /diagram/skip": () => ({}),
  });
  const call = createCallTool({
    resolveLock: () => editor.lock,
    mapService: f.service,
  });
  await assert.rejects(
    call("kanko_diagram_put", {
      workspace: f.workspace,
      mapId: f.mapId,
      diagram: f.k02Diagram(),
    }),
    (e) => code(e) === "diagrams_on_request",
  );
  const skipped = record(
    await call("kanko_diagram_skip", {
      workspace: f.workspace,
      mapId: f.mapId,
      stopId: "K05",
      reason: "Adds 2 counters.",
    }),
  );
  assert.equal(skipped.shown, true);
  // Streaming: metadata first, then nodes; the stop comes from the editor.
  const { after, ...meta } = f.k03Timeline();
  const base = {
    workspace: f.workspace,
    mapId: f.mapId,
    detourId: "req_1",
    diagramId: "timeline-1",
  };
  const first = record(
    await call("kanko_diagram_stream", {
      ...base,
      patch: {
        kind: meta.kind,
        title: meta.title,
        after: {
          axis: after.axis,
          lanes: after.lanes,
          nodes: [],
          edges: after.edges,
        },
        status: "Reading policy.go and deadline.go",
        question:
          "How do the attempt limit and the deadline interact? Draw it.",
      },
    }),
  );
  assert.equal(first.final, false);
  const streamed = record(editor.seen.at(-1)?.[1]);
  assert.equal(record(streamed.draft).stopId, "K03");
  assert.equal(streamed.status, "Reading policy.go and deadline.go");
  await call("kanko_diagram_stream", {
    ...base,
    patch: { after: { nodes: after.nodes.slice(0, 2) } },
  });
  const final = record(
    await call("kanko_diagram_stream", {
      ...base,
      final: true,
      patch: {
        ...meta,
        after: { nodes: after.nodes.slice(2) },
        answer: "Attempt 3 never starts.",
      },
    }),
  );
  assert.equal(final.diagramId, "timeline-1");
  assert.equal(final.shown, true);
  const shown = record(editor.seen.at(-1)?.[1]);
  assert.equal(shown.final, true);
  assert.equal(record(shown.diagram).detourId, "req_1");
  assert.equal(records(record(record(shown.diagram).after).nodes).length, 4);
  // A malformed patch never reaches the editor.
  const before = editor.seen.length;
  await assert.rejects(
    call("kanko_diagram_stream", {
      ...base,
      diagramId: "bad",
      patch: { kind: "chart", title: "x" },
    }),
    (e) => code(e) === "invalid_diagram",
  );
  assert.equal(editor.seen.length, before + 1); // only the status read
});

test("without an editor, defaults apply and the stored diagram reports it was not shown", async (t) => {
  const f = fixture(t);
  const call = createCallTool({
    resolveLock: () => {
      throw Object.assign(new Error("no editor"), { code: "no_bridge" });
    },
    mapService: f.service,
  });
  const put = record(
    await call("kanko_diagram_put", {
      workspace: f.workspace,
      mapId: f.mapId,
      diagram: f.k02Diagram(),
    }),
  );
  assert.equal(put.shown, false);
  assert.match(String(put.editor), /no editor/);
  await assert.rejects(
    call("kanko_await_reviewer", { workspace: f.workspace }),
    /no editor/,
  );
});

test("kanko_await_reviewer saves reviewer pins and feedback before returning events", async (t) => {
  const f = fixture(t);
  const put = f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: f.k03Timeline(),
    settings: auto,
  });
  const editor = await fakeEditor(t, {
    "POST /reviewer/await": () => ({
      events: [
        {
          kind: "diagram_request",
          id: "req_9",
          mapId: f.mapId,
          stopId: "K05",
          context: {
            stopId: "K05",
            beatId: "counters",
            mode: "following",
            selectedAnchor: 1,
          },
        },
        {
          kind: "diagram_pin",
          id: "pin_1",
          mapId: f.mapId,
          diagramId: put.diagramId,
          stopId: "K03",
        },
        {
          kind: "diagram_feedback",
          id: "fb_1",
          mapId: f.mapId,
          diagramId: put.diagramId,
          value: "not_helpful",
        },
        {
          kind: "diagram_pin",
          id: "pin_2",
          mapId: f.mapId,
          diagramId: "dgm_gone",
          stopId: "K03",
        },
      ],
    }),
  });
  const call = createCallTool({
    resolveLock: () => editor.lock,
    mapService: f.service,
  });
  const result = record(
    await call("kanko_await_reviewer", {
      workspace: f.workspace,
      timeoutMs: 5,
    }),
  );
  assert.equal(editor.seen[0][1].timeoutMs, 5);
  const events = records(result.events);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["diagram_request", "diagram_pinned", "diagram_feedback", "diagram_pin"],
  );
  assert.match(String(events[3].persistError), /diagram not found/);
  const items = records(
    record(
      f.service.get({
        workspace: f.workspace,
        mapId: f.mapId,
        selector: { kind: "diagrams" },
      }),
    ).items,
  );
  assert.deepEqual(
    items.map((d) => [d.id, d.pinned, d.feedback]),
    [[put.diagramId, true, "not_helpful"]],
  );
});
