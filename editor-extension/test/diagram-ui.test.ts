import type { LoadedTourSnapshot } from "../src/shared/snapshot.js";
import type { SidebarMessage } from "../src/shared/messages.js";
import type {
  DiagramSnapshot,
  DiagramView,
} from "../src/shared/diagram-view.js";
import { dom } from "./ui/environment.js";
import { test, afterEach, after, before } from "node:test";
import assert = require("node:assert/strict");
import * as React from "react";
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { App } from "../src/webview/App.js";
import { DiagramPanelApp } from "../src/webview/DiagramPanelApp.js";
import { createBridge } from "../src/webview/bridge.js";
import { buildView } from "../src/host/diagrams.js";
import { snapshot as baseSnapshot } from "./ui/snapshot.js";
import { paymentsFixture } from "../../test/diagram-fixture.js";

afterEach(cleanup);
const cleanups: (() => void)[] = [];
after(() => {
  dom.window.close();
  for (const fn of cleanups) fn();
});

let k02: DiagramView;
let timeline: DiagramView;
before(async () => {
  const f = paymentsFixture((fn) => cleanups.push(fn));
  const diagram = { ...f.k02Diagram(), id: "dgm_k02", pinned: false };
  k02 = await buildView(diagram, { claims: { C2: "contradicted" } });
  timeline = await buildView({
    ...f.k03Timeline(),
    id: "timeline-1",
    pinned: false,
  });
});

const beats = [
  { id: "limits", narration: "Limits", active: [1] },
  { id: "key", narration: "Key", active: [1] },
  { id: "timeout", narration: "Timeout", active: [1] },
  { id: "fallthrough", narration: "Rest", active: [1] },
];
function snapshot(
  diagrams: Partial<DiagramSnapshot> = {},
  beat = "key",
): LoadedTourSnapshot {
  const base = baseSnapshot(1);
  const current = {
    ...beats.find((b) => b.id === beat)!,
    narration: "Inspect {{a:1}}",
  };
  return {
    ...base,
    revision: 5,
    stop: { ...base.stop, id: "K02", title: "Idempotency boundary", beats },
    beat: current,
    beatIndex: beats.findIndex((b) => b.id === beat),
    beatCount: beats.length,
    diagrams: {
      ...base.diagrams,
      cards: [k02],
      tourMap: [
        {
          stopId: "K02",
          title: "Idempotency boundary",
          label: "K02",
          state: "auto",
          reason: k02.reason,
          current: true,
          firstBeatId: "limits",
        },
        {
          stopId: "K03",
          title: "Retry policy and deadline",
          label: "K03",
          state: "requested",
          reason: "You asked.",
          current: false,
          firstBeatId: "policy",
        },
        {
          stopId: "K05",
          title: "Metrics",
          label: "K05",
          state: "skipped",
          reason: "Adds 2 counters and no new control flow.",
          current: false,
          firstBeatId: "counters",
        },
      ],
      ...diagrams,
    },
  };
}
function setup(
  app: "tour" | "panel" = "tour",
  initial: LoadedTourSnapshot = snapshot(),
) {
  const messages: SidebarMessage[] = [];
  const bridge = createBridge({ postMessage: (m) => messages.push(m) }, window);
  const rendered = render(
    React.createElement(app === "tour" ? App : DiagramPanelApp, { bridge }),
  );
  const receive = (data: unknown) =>
    act(() =>
      window.dispatchEvent(new window.MessageEvent("message", { data })),
    );
  receive({ type: "snapshot", snapshot: initial });
  return {
    ...rendered,
    messages,
    receive,
    update: (s: LoadedTourSnapshot) =>
      receive({ type: "snapshot", snapshot: s }),
  };
}
const node = (container: HTMLElement, id: string) => {
  const found = [
    ...container.querySelectorAll<SVGGElement>("[data-node]"),
  ].find((el) => el.dataset.node === id);
  assert.ok(found, id);
  return found;
};
const edge = (container: HTMLElement, id: string) =>
  [...container.querySelectorAll<SVGGElement>("[data-edge]")].find(
    (el) => el.dataset.edge === id,
  );
const sent = (messages: SidebarMessage[]) =>
  messages.filter((m) => m.type !== "ready");

test("the card highlights the current beat's node and edge under the narration", () => {
  const f = setup();
  const card = screen.getByRole("region", {
    name: "Diagram: How a failed send is classified",
  });
  assert.ok(
    card.compareDocumentPosition(document.getElementById("narration")!) &
      window.Node.DOCUMENT_POSITION_PRECEDING,
  );
  assert.equal(
    screen.getByText("derived · classify.go").className,
    "dg-chip dg-chip-derived",
  );
  assert.ok(screen.getByText("The stop adds 3 branches to one function."));
  const key = node(f.container, "decide#key");
  assert.match(key.getAttribute("class") || "", /dg-current/);
  assert.equal(key.getAttribute("aria-current"), "step");
  assert.match(
    edge(f.container, "e-key-yes")?.getAttribute("class") || "",
    /dg-current/,
  );
  assert.doesNotMatch(
    edge(f.container, "e-key-no")?.getAttribute("class") || "",
    /dg-current/,
  );
  assert.doesNotMatch(
    node(f.container, "decide#timeout").getAttribute("class") || "",
    /dg-current/,
  );
  // The disputed claim is written, not only colored.
  assert.ok(screen.getByText("C2 contradicted"));
  const svg = screen.getByRole("img", {
    name: /^Flow diagram, How a failed send is classified: 10 nodes and 9 connections/,
  });
  assert.ok(svg);
  // The card shows the after drawing: removed before-only items are absent.
  assert.equal(f.container.querySelectorAll("[data-node]").length, 10);
  f.update(snapshot({}, "timeout"));
  assert.match(
    node(f.container, "decide#timeout").getAttribute("class") || "",
    /dg-current/,
  );
});

test("clicking or pressing Enter on a node asks the host to move the pointer", () => {
  const f = setup();
  fireEvent.click(node(f.container, "decide#key"));
  assert.deepEqual(sent(f.messages).at(-1), {
    type: "diagramNode",
    diagramId: "dgm_k02",
    nodeId: "decide#key",
    revision: 5,
  });
  const start = node(f.container, "decide#start");
  start.focus();
  fireEvent.keyDown(start, { key: "ArrowDown" });
  assert.equal(document.activeElement, node(f.container, "decide#limits"));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  assert.equal(document.activeElement, start);
  fireEvent.keyDown(start, { key: "Enter" });
  assert.deepEqual(sent(f.messages).at(-1), {
    type: "diagramNode",
    diagramId: "dgm_k02",
    nodeId: "decide#start",
    revision: 5,
  });
  // Nodes are tabbable in reading order: top to bottom.
  const order = [
    ...f.container.querySelectorAll<SVGGElement>("[data-node][tabindex='0']"),
  ].map((el) => el.dataset.node);
  assert.equal(order[0], "decide#start");
  assert.equal(order.length, 10);
});

test("an unanchored sketch node explains itself instead of navigating", async () => {
  const sketch = await buildView({
    id: "sketch",
    kind: "flow",
    title: "Sketch",
    stopId: "K02",
    origin: "auto",
    reason: "Concept only.",
    pinned: false,
    provenance: {
      status: "inferred",
      method: "agent-sketch",
      sources: [],
      revs: { after: "abc" },
    },
    after: {
      nodes: [
        { id: "a", label: "Idea", shape: "action" },
        { id: "b", label: "Effect", shape: "action" },
      ],
      edges: [{ id: "e", from: "a", to: "b" }],
    },
  });
  const f = setup("tour", snapshot({ cards: [sketch] }));
  assert.ok(screen.getByText("inferred · sketched by Kankō"));
  assert.match(f.container.querySelector(".dg-card")!.className, /dg-inferred/);
  fireEvent.click(node(f.container, "a"));
  assert.ok(screen.getByText("Idea: sketched, with no code location."));
  assert.deepEqual(sent(f.messages), []);
  assert.ok(screen.getByText(/sketched by Kankō; not proof/));
});

test("card actions: describe, open beside, not helpful, collapsed, open-beside row", () => {
  const f = setup();
  fireEvent.click(screen.getByRole("button", { name: "Describe as text" }));
  const list = screen.getByRole("list", {
    name: "How a failed send is classified as text",
  });
  assert.equal(
    list.querySelectorAll("li")[0].textContent,
    "Send failed [changed]: → Attempts left, within deadline?",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open beside code" }));
  fireEvent.click(screen.getByRole("button", { name: "Not helpful" }));
  assert.deepEqual(sent(f.messages), [
    { type: "diagramOpen", diagramId: "dgm_k02", revision: 5 },
    { type: "diagramFeedback", diagramId: "dgm_k02", revision: 5 },
  ]);
  f.update(snapshot({ collapsed: true }));
  assert.equal(document.querySelector(".dg-card"), null);
  fireEvent.click(screen.getByRole("button", { name: "Show diagram" }));
  assert.deepEqual(sent(f.messages).at(-1), {
    type: "diagramExpand",
    stopId: "K02",
    revision: 5,
  });
  f.update(
    snapshot({
      settings: { ...snapshot().diagrams.settings, openBeside: "never" },
    }),
  );
  assert.equal(
    screen.queryByRole("button", { name: "Open beside code" }),
    null,
  );
  f.update(snapshot());
  f.receive({ type: "panel", view: k02, follow: true });
  assert.ok(screen.getByText("Diagram open beside code"));
  assert.equal(document.querySelector(".dg-card"), null);
});

test("skipped, pending and stale stops offer the matching request", () => {
  const f = setup(
    "tour",
    snapshot({
      cards: [],
      skip: {
        stopId: "K02",
        reason: "Adds 2 counters and no new control flow.",
        recordedAt: "now",
      },
    }),
  );
  assert.ok(screen.getByText("Adds 2 counters and no new control flow."));
  fireEvent.click(screen.getByRole("button", { name: "Draw one anyway" }));
  assert.deepEqual(sent(f.messages).at(-1), {
    type: "diagramRequest",
    stopId: "K02",
    revision: 5,
  });
  f.update(snapshot({ cards: [], pending: true }));
  assert.ok(screen.getByText("Kankō is drawing a diagram for this stop…"));
  f.update(
    snapshot({
      cards: [
        { ...k02, stale: true, chip: "stale · code changed since drawn" },
      ],
      redrawAt: "9c41d0a",
    }),
  );
  assert.ok(screen.getByText("stale · code changed since drawn"));
  assert.match(document.querySelector(".dg-card")!.className, /dg-stale-card/);
  fireEvent.click(screen.getByRole("button", { name: "Redraw at 9c41d0a" }));
  assert.deepEqual(sent(f.messages).at(-1), {
    type: "diagramRequest",
    stopId: "K02",
    replaces: "dgm_k02",
    revision: 5,
  });
});

test("a large diagram shows a thumbnail on the card and opens the full view", async () => {
  const nodes = Array.from({ length: 14 }, (_, i) => ({
    id: `n${i}`,
    label: `Step ${i}`,
    shape: "action" as const,
  }));
  const big = await buildView({
    id: "big",
    kind: "flow",
    title: "Big",
    stopId: "K02",
    origin: "auto",
    reason: "Many steps.",
    pinned: false,
    provenance: {
      status: "inferred",
      method: "agent-sketch",
      sources: [],
      revs: { after: "abc" },
    },
    after: {
      nodes,
      edges: nodes
        .slice(1)
        .map((n, i) => ({ id: `e${i}`, from: `n${i}`, to: n.id })),
    },
  });
  const f = setup("tour", snapshot({ cards: [big] }));
  assert.ok(f.container.querySelector(".dg-thumb"));
  assert.equal(
    f.container.querySelectorAll("[role=button][data-node]").length,
    0,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Open the full diagram" }),
  );
  assert.deepEqual(sent(f.messages).at(-1), {
    type: "diagramOpen",
    diagramId: "big",
    revision: 5,
  });
});

test("a detour streams with a drawing chip, then offers pin, open beside and return", () => {
  const draft = {
    ...timeline,
    id: "timeline-1",
    streaming: true,
    chip: "drawing…",
  };
  const f = setup(
    "tour",
    snapshot({
      detour: {
        id: "req_1",
        stopId: "K03",
        stopTitle: "Retry policy",
        stopLabel: "K03",
        question:
          "How do the attempt limit and the deadline interact? Draw it.",
        status: "Reading policy.go and deadline.go",
        final: false,
        pinned: false,
        diagram: draft,
      },
    }),
  );
  assert.ok(
    screen
      .getByRole("navigation", { name: "Breadcrumb" })
      .textContent?.includes("K03 Retry policy"),
  );
  assert.ok(screen.getByText("drawing…"));
  assert.ok(screen.getByText("Reading policy.go and deadline.go"));
  assert.equal(screen.queryByRole("button", { name: "Pin to K03" }), null);
  assert.equal(document.getElementById("narration"), null);
  f.update(
    snapshot({
      detour: {
        id: "req_1",
        stopId: "K03",
        stopTitle: "Retry policy",
        stopLabel: "K03",
        answer: "Attempt 3 never starts.",
        final: true,
        pinned: false,
        diagram: timeline,
      },
    }),
  );
  assert.ok(screen.getByText("derived · policy.go, deadline.go"));
  assert.ok(screen.getByText("Attempt 3 never starts."));
  fireEvent.click(screen.getByRole("button", { name: "Pin to K03" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Return to tour at K02, beat 2" }),
  );
  assert.deepEqual(sent(f.messages), [
    { type: "diagramPin", diagramId: "timeline-1", stopId: "K03", revision: 5 },
    { type: "detourReturn", revision: 5 },
  ]);
  f.update(
    snapshot({
      detour: {
        id: "req_1",
        stopId: "K03",
        stopTitle: "Retry policy",
        stopLabel: "K03",
        final: true,
        pinned: true,
        diagram: timeline,
      },
    }),
  );
  assert.equal(
    screen.getByRole<HTMLButtonElement>("button", { name: "Pinned to K03" })
      .disabled,
    true,
  );
});

test("the tour map lists each stop's diagram state and edits settings", () => {
  const f = setup();
  const map = document.getElementById("tour-map") as HTMLDetailsElement;
  assert.equal(screen.queryByRole("radio", { name: "Kankō decides" }), null);
  act(() => {
    map.open = true;
    map.dispatchEvent(new window.Event("toggle"));
  });
  assert.ok(screen.getByText("drawn automatically"));
  assert.ok(screen.getByText("you asked"));
  assert.ok(screen.getByText("no diagram"));
  fireEvent.click(
    screen.getAllByRole("button", { name: "Draw one anyway" })[0],
  );
  fireEvent.click(
    screen.getByRole("button", { name: "K03 · Retry policy and deadline" }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "Only when I ask" }));
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Only from code or traces, no sketches",
    }),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: /Automatic diagrams per stop/ }),
    { target: { value: "2" } },
  );
  assert.deepEqual(sent(f.messages), [
    { type: "diagramRequest", stopId: "K05", revision: 5 },
    { type: "gotoBeat", stopId: "K03", beatId: "policy", revision: 5 },
    { type: "diagramSettings", settings: { mode: "onRequest" }, revision: 5 },
    { type: "diagramSettings", settings: { derivedOnly: true }, revision: 5 },
    { type: "diagramSettings", settings: { maxPerStop: 2 }, revision: 5 },
  ]);
});

test("off mode hides every diagram but keeps the settings reachable", () => {
  setup(
    "tour",
    snapshot({
      cards: [k02],
      skip: { stopId: "K02", reason: "x", recordedAt: "y" },
      settings: { ...snapshot().diagrams.settings, mode: "off" },
    }),
  );
  assert.equal(document.querySelector(".dg-card"), null);
  assert.equal(document.getElementById("diagram-skip"), null);
  assert.equal(screen.queryByText("drawn automatically"), null);
  assert.ok(screen.getByText("Diagram settings"));
});

test("the expanded view defaults to Diff with written tags and keeps positions across modes", () => {
  const f = setup("panel");
  f.receive({ type: "panel", view: k02, follow: true });
  assert.equal(
    screen.getByRole("button", { name: "Diff" }).getAttribute("aria-pressed"),
    "true",
  );
  assert.ok(screen.getByText(/^derived · [0-9a-f]{7} vs [0-9a-f]{7}$/));
  const tag = (id: string) =>
    node(f.container, id).querySelector(".dg-tag text")?.textContent;
  for (const id of ["decide#limits", "decide#key", "decide#timeout"])
    assert.equal(tag(id), "new");
  assert.equal(tag("decide#sent"), "changed");
  assert.equal(tag("decide#backoff"), "changed");
  assert.ok(
    node(f.container, "decide#sent").textContent?.includes(
      "was: Connection refused or DNS?",
    ),
  );
  assert.ok(
    node(f.container, "decide#backoff").textContent?.includes(
      "was: Retry once",
    ),
  );
  const rect = (id: string) =>
    node(f.container, id).querySelector("rect")!.getAttribute("y");
  const sentY = rect("decide#sent");
  fireEvent.click(screen.getByRole("button", { name: "Before" }));
  assert.equal(f.container.querySelectorAll("[data-node]").length, 4);
  assert.equal(rect("decide#sent"), sentY);
  assert.equal(node(f.container, "decide#sent").querySelector(".dg-tag"), null);
  fireEvent.click(screen.getByRole("button", { name: "After" }));
  assert.equal(f.container.querySelectorAll("[data-node]").length, 10);
});

test("Follow tour: beat changes re-highlight while on, and leave the diagram alone while off", () => {
  const f = setup("panel");
  f.receive({ type: "panel", view: k02, follow: true });
  assert.match(
    node(f.container, "decide#key").getAttribute("class") || "",
    /dg-current/,
  );
  f.update(snapshot({}, "timeout"));
  assert.match(
    node(f.container, "decide#timeout").getAttribute("class") || "",
    /dg-current/,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Follow tour" }));
  assert.deepEqual(sent(f.messages).at(-1), {
    type: "panelFollow",
    follow: false,
    revision: 5,
  });
  f.receive({ type: "panel", view: k02, follow: false });
  f.update(snapshot({}, "limits"));
  assert.match(
    node(f.container, "decide#timeout").getAttribute("class") || "",
    /dg-current/,
  );
  assert.doesNotMatch(
    node(f.container, "decide#limits").getAttribute("class") || "",
    /dg-current/,
  );
  // The beat strip and node clicks still drive the tour explicitly.
  const chips = screen.getByRole("navigation", {
    name: "Beats in this diagram",
  });
  assert.deepEqual(
    [...chips.querySelectorAll("button")].map((b) => b.textContent),
    [
      "1 · Attempts left, within…",
      "2 · Has idempotency key?",
      "3 · Read timeout?",
      "4 · Sent any bytes?",
    ],
  );
  fireEvent.click(
    screen.getByRole("button", { name: "2 · Has idempotency key?" }),
  );
  assert.deepEqual(sent(f.messages).at(-1), {
    type: "gotoBeat",
    stopId: "K02",
    beatId: "key",
    revision: 5,
  });
});

test("panning the expanded view pauses auto-scroll until Return to tour", () => {
  const f = setup("panel");
  f.receive({ type: "panel", view: k02, follow: true });
  assert.equal(screen.queryByRole("button", { name: "Return to tour" }), null);
  fireEvent.wheel(f.container.querySelector(".dg-viewport")!);
  fireEvent.click(screen.getByRole("button", { name: "Return to tour" }));
  assert.equal(screen.queryByRole("button", { name: "Return to tour" }), null);
  fireEvent.pointerDown(node(f.container, "decide#key"));
  assert.equal(screen.queryByRole("button", { name: "Return to tour" }), null);
});
