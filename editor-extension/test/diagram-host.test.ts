import { test, type TestContext } from "node:test";
import assert = require("node:assert/strict");
import type { TourPlan } from "../src/shared/tour.js";
import type {
  LoadedTourSnapshot,
  TourSnapshot,
} from "../src/shared/snapshot.js";
import type { Diagram } from "../../generated/shared/diagram.js";
import { paymentsFixture } from "../../test/diagram-fixture.js";
import { present, record } from "../../test/assertions.js";
import { state as makeState } from "./factories.js";
import { layoutDiagram } from "../src/host/diagram-layout.js";
import {
  anchorForNode,
  buildView,
  diagramSnapshot,
  markNotHelpful,
  prepareDiagrams,
  putDiagram,
  readStream,
  requestDiagram,
  returnToTour,
  skipDiagram,
  streamDiagram,
} from "../src/host/diagrams.js";
import { createTourController } from "../src/host/tour-controller.js";
import { createReviewerEvents } from "../src/host/reviewer-events.js";
import { createDiagramActions } from "../src/host/diagram-actions.js";
import { DEFAULT_DIAGRAM_SETTINGS } from "../../generated/shared/diagram.js";

const auto = DEFAULT_DIAGRAM_SETTINGS;

/** A loaded payments tour as the MCP server would send it. */
function loaded(
  t: TestContext,
  prepare?: (f: ReturnType<typeof paymentsFixture>) => void,
) {
  const f = paymentsFixture((fn) => t.after(fn));
  prepare?.(f);
  const body = f.service.loadTour({ workspace: f.workspace, mapId: f.mapId });
  return { f, body, plan: body.plan as TourPlan };
}
const stored = (
  f: ReturnType<typeof paymentsFixture>,
  input = f.k02Diagram(),
) =>
  f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: input,
    settings: auto,
  }).diagram as Diagram & { stale: boolean };

test("layout is deterministic and before/after share one set of positions", async (t) => {
  const { f } = loaded(t);
  const diagram = f.k02Diagram();
  const one = await layoutDiagram(diagram);
  const two = await layoutDiagram(structuredClone(diagram));
  assert.deepEqual(one.geometry, two.geometry);
  const ids = one.geometry.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  // Removed before-only items join the union; new items are after-only.
  assert.deepEqual(
    one.geometry.nodes
      .filter((n) => n.status === "new")
      .map((n) => [n.id, n.sides]),
    [
      ["decide#limits", ["after"]],
      ["decide#limits-fail", ["after"]],
      ["decide#key", ["after"]],
      ["decide#same-key", ["after"]],
      ["decide#timeout", ["after"]],
      ["decide#timeout-retry", ["after"]],
    ],
  );
  const sent = present(one.geometry.nodes.find((n) => n.id === "decide#sent"));
  assert.deepEqual(
    [sent.status, sent.was, sent.sides],
    ["changed", "Connection refused or DNS?", ["before", "after"]],
  );
  for (const node of one.geometry.nodes)
    assert.ok(node.width > 0 && node.height > 0);
  for (const edge of one.geometry.edges)
    assert.ok(edge.points.length >= 2, edge.id);
  // The flow runs top to bottom.
  const y = (id: string) =>
    present(one.geometry.nodes.find((n) => n.id === id)).y;
  assert.ok(
    y("decide#start") < y("decide#limits") &&
      y("decide#limits") < y("decide#key"),
  );
});

test("timeline and sequence layouts use fixed lanes and an axis", async (t) => {
  const { f } = loaded(t);
  const { geometry } = await layoutDiagram(f.k03Timeline());
  const axis = present(geometry.axis);
  assert.deepEqual(
    axis.ticks.map((tick) => tick.label),
    ["0s", "0.5s", "1s", "1.5s", "2s"],
  );
  assert.deepEqual(
    axis.marks.map((m) => [m.label, m.kind]),
    [
      ["deadline 2.0s", "deadline"],
      ["Fail at 1.4s", "event"],
    ],
  );
  const span = (id: string) => present(geometry.nodes.find((n) => n.id === id));
  assert.ok(span("try1").x < span("try2").x);
  assert.equal(span("try3").ghost, true);
  assert.ok(
    span("try3").x + span("try3").width <= axis.x1 + 0.1,
    "spans are clamped to the axis",
  );
  const sequence = await layoutDiagram({
    kind: "sequence",
    after: {
      nodes: [
        { id: "api", label: "API", shape: "participant" },
        { id: "retry", label: "Retrier", shape: "participant" },
        { id: "psp", label: "Processor", shape: "participant" },
      ],
      edges: [
        {
          id: "m2",
          from: "retry",
          to: "psp",
          label: "Send, attempt 2",
          order: 2,
        },
        { id: "m1", from: "api", to: "retry", label: "Charge", order: 1 },
        {
          id: "m3",
          from: "psp",
          to: "api",
          kind: "return",
          label: "ok",
          order: 3,
        },
      ],
    },
  });
  assert.deepEqual(
    sequence.geometry.edges.map((e) => e.id),
    ["m1", "m2", "m3"],
  );
  assert.ok(
    sequence.geometry.edges[0].points[0].y <
      sequence.geometry.edges[1].points[0].y,
  );
  assert.equal(sequence.geometry.lanes.length, 3);
});

test("streamed edges get placeholder endpoints until their nodes arrive", async () => {
  const { geometry } = await layoutDiagram(
    {
      kind: "flow",
      after: {
        nodes: [{ id: "a", label: "Start", shape: "start" }],
        edges: [{ id: "e", from: "a", to: "b" }],
      },
    },
    { streaming: true },
  );
  assert.deepEqual(
    geometry.nodes.map((n) => [n.id, n.placeholder === true]),
    [
      ["a", false],
      ["b", true],
    ],
  );
});

test("views carry beats, code locations, claim status, and text descriptions", async (t) => {
  const { f } = loaded(t);
  const view = await buildView(
    { ...stored(f), id: "d1" },
    { claims: { C2: "contradicted" } },
  );
  assert.equal(view.chip, "derived · classify.go");
  assert.equal(view.tabTitle, "Flow · Decide");
  assert.equal(
    view.revisionChip,
    `derived · ${f.base.slice(0, 7)} vs ${f.head.slice(0, 7)}`,
  );
  const key = present(view.layout.nodes.find((n) => n.id === "decide#key"));
  assert.deepEqual(key.beatIds, ["key"]);
  assert.equal(
    key.location,
    `payments/retry/classify.go:${f.spans.key[0]}–${f.spans.key[1]}`,
  );
  const disputed = present(
    view.layout.nodes.find((n) => n.id === "decide#timeout-retry"),
  );
  assert.deepEqual(disputed.claims, [
    { id: "C2", status: "contradicted", attention: true },
  ]);
  assert.ok(view.description.after.length >= 10);
  assert.ok(view.description.before);
  assert.match(
    view.aria,
    /^Flow diagram, How a failed send is classified: 10 nodes/,
  );
  const stale = await buildView(
    { ...stored(f, f.k03Timeline()), id: "d2" },
    { stale: true },
  );
  assert.equal(stale.chip, "stale · code changed since drawn");
  assert.match(stale.aria, /Stale: code changed since drawn\.$/);
});

test("load prepares cards, skips, collapsed stops and the tour map", async (t) => {
  const { body, plan } = loaded(t, (f) => {
    stored(f);
    f.service.diagramSkip({
      workspace: f.workspace,
      mapId: f.mapId,
      stopId: "K05",
      reason: "Adds 2 counters and no new control flow.",
    });
  });
  const state = await prepareDiagrams(body, plan, auto);
  assert.equal(state.claims.C2, "contradicted");
  const k02 = diagramSnapshot(state, plan, plan.stops[0]);
  assert.equal(k02.cards.length, 1);
  assert.deepEqual(
    k02.tourMap.map((e) => [e.label, e.state, e.current]),
    [
      ["K02", "auto", true],
      ["K03", "none", false],
      ["K05", "skipped", false],
    ],
  );
  const k05 = diagramSnapshot(state, plan, plan.stops[2]);
  assert.deepEqual(
    [k05.cards.length, k05.skip?.reason],
    [0, "Adds 2 counters and no new control flow."],
  );
  const hidden = markNotHelpful(state, k02.cards[0].id);
  assert.equal(diagramSnapshot(hidden, plan, plan.stops[0]).collapsed, true);
  const off = diagramSnapshot(
    { ...state, settings: { ...auto, mode: "off" } },
    plan,
    plan.stops[0],
  );
  assert.deepEqual([off.cards, off.tourMap, off.skip], [[], [], undefined]);
  assert.equal(k02.redrawAt, plan.stops[0].anchors[0].rev.head.slice(0, 7));
});

test("a stored drawing that no longer fits the plan is skipped, not fatal", async (t) => {
  const { body, plan } = loaded(t, (f) => void stored(f));
  const broken = {
    ...body,
    diagrams: {
      ...body.diagrams,
      items: [
        { ...body.diagrams.items[0], stopId: "K99" },
        ...body.diagrams.items,
      ],
    },
  };
  const state = await prepareDiagrams(broken, plan, auto);
  assert.equal(Object.keys(state.records).length, 1);
});

test("a working-tree drift on an anchored file makes the drawing stale", async (t) => {
  const { body, plan } = loaded(t, (f) => void stored(f));
  const state = await prepareDiagrams(body, plan, auto);
  const drifted = diagramSnapshot(state, plan, plan.stops[0], [
    {
      n: 3,
      path: "payments/retry/classify.go",
      status: "stale",
      column: 1,
      source: "file",
      companionColumn: null,
      removedCode: null,
    },
  ]);
  assert.equal(drifted.cards[0].stale, true);
  assert.equal(drifted.cards[0].chip, "stale · code changed since drawn");
  assert.equal(
    drifted.cards[0].description.after[0],
    "Stale: the code changed since this was drawn.",
  );
});

test("puts, skips, redraws, requests, streams and pins update a fresh state", async (t) => {
  const { f, body, plan } = loaded(t);
  let state = await prepareDiagrams(body, plan, auto);
  const first = stored(f);
  state = await putDiagram(state, plan, first);
  state = skipDiagram(state, plan, {
    stopId: "K05",
    reason: "Counters only.",
    recordedAt: "2026-10-05T00:00:00.000Z",
  });
  assert.throws(() =>
    skipDiagram(state, plan, { stopId: "K99", reason: "x", recordedAt: "y" }),
  );
  await assert.rejects(putDiagram(state, plan, { id: "x" }), /malformed/);
  const redraw = f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: f.k02Diagram({ replaces: first.id }),
    settings: auto,
  }).diagram;
  state = await putDiagram(state, plan, redraw);
  assert.deepEqual(
    diagramSnapshot(state, plan, plan.stops[0]).cards.map((c) => c.id),
    [record(redraw).id],
  );

  // Draw one anyway opens a pending detour.
  state = requestDiagram(state, "K03", "req_1");
  let snap = diagramSnapshot(state, plan, plan.stops[1]);
  assert.equal(snap.pending, true);
  assert.equal(snap.detour?.question, "Draw a diagram for this stop.");
  // The agent streams a partial drawing into that detour.
  const timeline = f.k03Timeline();
  state = await streamDiagram(
    state,
    plan,
    "K03",
    readStream({
      detourId: "req_1",
      diagramId: "timeline-1",
      final: false,
      status: "Reading policy.go and deadline.go",
      draft: {
        kind: "timeline",
        title: timeline.title,
        stopId: "K03",
        after: { ...timeline.after, nodes: timeline.after.nodes.slice(0, 1) },
      },
    }),
  );
  snap = diagramSnapshot(state, plan, plan.stops[1]);
  assert.deepEqual(
    [snap.detour?.diagram?.chip, snap.detour?.status, snap.detour?.final],
    ["drawing…", "Reading policy.go and deadline.go", false],
  );
  assert.equal(snap.detour?.diagram?.streaming, true);
  await assert.rejects(
    streamDiagram(
      state,
      plan,
      "K03",
      readStream({
        detourId: "req_1",
        diagramId: "t",
        final: false,
        draft: { kind: "chart", title: "x" },
      }),
    ),
    /malformed/,
  );
  // The final patch stores the diagram; it shows on the stop only once pinned.
  const final = f.service.diagramPut(
    {
      workspace: f.workspace,
      mapId: f.mapId,
      diagram: { ...timeline, detourId: "req_1" },
      settings: auto,
    },
    { id: "timeline-1" },
  ).diagram;
  state = await streamDiagram(
    state,
    plan,
    "K03",
    readStream({
      detourId: "req_1",
      diagramId: "timeline-1",
      final: true,
      diagram: final,
      answer: "Attempt 3 never starts.",
    }),
  );
  snap = diagramSnapshot(state, plan, plan.stops[1]);
  assert.deepEqual(
    [
      snap.pending,
      snap.detour?.final,
      snap.detour?.diagram?.chip,
      snap.detour?.answer,
      snap.cards.length,
    ],
    [
      false,
      true,
      "derived · policy.go, deadline.go",
      "Attempt 3 never starts.",
      0,
    ],
  );
  const { pinDiagram } = await import("../src/host/diagrams.js");
  state = await pinDiagram(state, plan, "timeline-1", "K03");
  snap = diagramSnapshot(state, plan, plan.stops[1]);
  assert.deepEqual(
    [snap.cards.map((c) => c.id), snap.detour?.pinned],
    [["timeline-1"], true],
  );
  assert.equal(snap.tourMap[1].state, "requested");
  assert.equal(
    diagramSnapshot(returnToTour(state), plan, plan.stops[1]).detour,
    undefined,
  );
});

test("a requested put without a stream still resolves the open request", async (t) => {
  const { f, body, plan } = loaded(t);
  let state = requestDiagram(
    await prepareDiagrams(body, plan, auto),
    "K03",
    "req_7",
  );
  const put = f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: f.k03Timeline(),
    settings: auto,
  }).diagram;
  state = await putDiagram(state, plan, put);
  const snap = diagramSnapshot(state, plan, plan.stops[1]);
  assert.deepEqual(
    [
      snap.pending,
      snap.detour?.id,
      snap.detour?.final,
      snap.detour?.diagram?.id,
    ],
    [false, "req_7", true, record(put).id],
  );
});

test("an unrequested drawing from conversation opens its own detour", async (t) => {
  const { f, body, plan } = loaded(t);
  const put = f.service.diagramPut({
    workspace: f.workspace,
    mapId: f.mapId,
    diagram: f.k03Timeline(),
    settings: auto,
  }).diagram;
  const state = await putDiagram(
    await prepareDiagrams(body, plan, auto),
    plan,
    put,
  );
  const snap = diagramSnapshot(state, plan, plan.stops[1]);
  assert.deepEqual(
    [
      snap.detour?.id,
      snap.detour?.final,
      snap.detour?.diagram?.id,
      snap.cards.length,
    ],
    [record(put).id, true, record(put).id, 0],
  );
});

test("node anchors resolve to the stop anchor that shows their lines", (t) => {
  const { f, plan } = loaded(t);
  const stop = plan.stops[0];
  const key = {
    path: "payments/retry/classify.go",
    side: "head" as const,
    context: { startLine: f.spans.key[0], endLine: f.spans.key[0] },
  };
  assert.equal(anchorForNode(stop, key), 3);
  assert.equal(
    anchorForNode(stop, {
      ...key,
      side: "base",
      context: { startLine: 1, endLine: 1 },
    }),
    1,
  );
  assert.equal(anchorForNode(stop, { ...key, path: "other.go" }), null);
});

test("reviewer events persist until taken and wake a waiting call", async () => {
  const saved = new Map<string, unknown>();
  const storage = {
    get: <T>(key: string) => saved.get(key) as T,
    update: (key: string, value: unknown) => void saved.set(key, value),
  };
  const events = createReviewerEvents(storage);
  assert.deepEqual(await events.take(0), []);
  const waiting = events.take(5000);
  events.push({
    kind: "diagram_feedback",
    id: "fb",
    mapId: "m",
    diagramId: "d",
    value: "not_helpful",
  });
  assert.deepEqual(
    (await waiting).map((e) => e.id),
    ["fb"],
  );
  events.push({
    kind: "diagram_pin",
    id: "pin",
    mapId: "m",
    diagramId: "d",
    stopId: "K03",
  });
  // A reload restores what the agent has not collected yet.
  assert.deepEqual(
    createReviewerEvents(storage)
      .pending()
      .map((e) => e.id),
    ["pin"],
  );
  assert.deepEqual(
    (await events.take(0)).map((e) => e.id),
    ["pin"],
  );
  assert.deepEqual(createReviewerEvents(storage).pending(), []);
  const start = Date.now();
  assert.deepEqual(await events.take(30), []);
  assert.ok(Date.now() - start >= 25);
});

function harness(t: TestContext) {
  const { f, body, plan } = loaded(t, (fx) => void stored(fx));
  const published: TourSnapshot[] = [];
  const focused: unknown[] = [];
  const controller = createTourController({
    prepare: async () => ({
      ...makeState(),
      plan,
      tourId: f.mapId,
      findings: [],
      workspace: f.workspace,
    }),
    present: async () => ({ anchors: [] }),
    clear: async () => {},
    publish: (s) => published.push(s),
    layoutAction: async () => ({ anchors: [] }),
    prepareDiagrams: (input, prepared) =>
      prepareDiagrams(input, prepared.plan, auto),
  });
  const originalFocus = controller.focus;
  controller.focus = (input: unknown) => {
    focused.push(input);
    return originalFocus(input);
  };
  return { f, body, plan, controller, published, focused };
}

test("the controller publishes diagram updates and rejects another tour's", async (t) => {
  const h = harness(t);
  const first = (await h.controller.load(h.body)) as LoadedTourSnapshot;
  assert.equal(first.diagrams.cards.length, 1);
  const next = await h.controller.updateDiagrams(h.f.mapId, (d) =>
    requestDiagram(d, "K03", "req_1"),
  );
  assert.ok(next.revision > first.revision);
  assert.equal(next.loaded && next.diagrams.detour?.id, "req_1");
  await assert.rejects(
    h.controller.updateDiagrams("map_other", (d) => d),
    /different tour/,
  );
  await h.controller.clear();
  await assert.rejects(
    h.controller.updateDiagrams(undefined, (d) => d),
    /Load a tour first/,
  );
});

test("clicking a node moves the presenter pointer locally, activating its beat", async (t) => {
  const h = harness(t);
  const loadedSnapshot = (await h.controller.load(
    h.body,
  )) as LoadedTourSnapshot;
  const events = createReviewerEvents();
  const shown: unknown[] = [];
  const actions = createDiagramActions(
    {
      Uri: { file: (p: string) => ({ fsPath: p }) },
      Range: class {
        constructor(...args: number[]) {
          Object.assign(this, { args });
        }
      },
      window: {
        showTextDocument: async (...args: unknown[]) => shown.push(args),
        showInformationMessage: async (m: string) => shown.push(m),
      },
      workspace: {
        getConfiguration: () => ({
          get: () => undefined,
          update: async () => {},
        }),
      },
      ConfigurationTarget: { Global: 1 },
    } as never,
    () => h.controller,
    events,
    () => undefined,
  );
  const id = loadedSnapshot.diagrams.cards[0].id;
  await actions.node(id, "decide#key", loadedSnapshot.revision);
  const after = h.controller.snapshot() as LoadedTourSnapshot;
  assert.equal(after.beat.id, "key");
  assert.equal(after.selectedAnchor, 3);
  assert.deepEqual(record(h.focused[0]).anchor, 3);
  // A node already on the current beat does not navigate again.
  await actions.node(id, "decide#same-key", after.revision);
  assert.equal((h.controller.snapshot() as LoadedTourSnapshot).beat.id, "key");
  await assert.rejects(actions.node(id, "missing", after.revision), /sketch/);
  // None of this reaches the agent.
  assert.deepEqual(events.pending(), []);
  // Requests, feedback and pins do.
  await actions.request("K03");
  await actions.feedback(id);
  assert.deepEqual(
    events.pending().map((e) => e.kind),
    ["diagram_request", "diagram_feedback"],
  );
  const request = events.pending()[0];
  assert.equal(
    request.kind === "diagram_request" && request.context.beatId,
    "key",
  );
  assert.equal(
    (h.controller.snapshot() as LoadedTourSnapshot).diagrams.collapsed,
    true,
  );
});
