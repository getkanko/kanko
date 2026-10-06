import { test } from "node:test";
import * as assert from "node:assert/strict";
import type { TourStop } from "../generated/shared/types.js";
import type { Graph } from "../generated/shared/diagram.js";
import {
  ariaSummary,
  describeGraph,
  diffGraphs,
  provenanceLabel,
  readDiagramSettings,
  revisionLabel,
} from "../generated/shared/diagram.js";
import {
  diagramIsStale,
  diagramSourceHash,
  validateDiagram,
} from "../generated/shared/diagram-validate.js";
import { computeDiagramSignals } from "../generated/shared/diagram-signals.js";
import { tourSources } from "../generated/shared/tour-sources.js";
import { hashText } from "../generated/shared/tour.js";
import { paymentsFixture } from "./diagram-fixture.js";

function context(t: { after(fn: () => void): void }) {
  const f = paymentsFixture((fn) => t.after(fn));
  const state = f.service.locate(f.workspace, f.mapId).state;
  const sources = tourSources(
    f.workspace,
    f.service.loadTour({ workspace: f.workspace, mapId: f.mapId }).change,
  );
  const plan = state.tourPlans[state.currentTourPlanId || ""];
  const options = {
    readSource: sources.readSource,
    revisions: sources.revisions,
    stops: plan.stops,
    claims: Object.values(state.entities.claims),
  };
  return { f, plan, sources, options };
}
const codes = (
  findings: { code: string; severity: string }[],
  severity = "error",
) => findings.filter((x) => x.severity === severity).map((x) => x.code);

test("the K02 flow validates against pinned sources and fills revisions", (t) => {
  const { f, options } = context(t);
  const checked = validateDiagram(f.k02Diagram(), options);
  assert.ok(checked.ok, JSON.stringify(checked.findings));
  assert.deepEqual(checked.diagram.after.nodes[0].anchor?.rev, {
    base: f.base,
    head: f.head,
  });
  assert.deepEqual(codes(checked.findings, "warning"), []);
  assert.match(diagramSourceHash(checked.diagram), /^sha256:[0-9a-f]{64}$/);
});

test("derived diagrams must anchor every node; sketches need not", (t) => {
  const { f, options } = context(t);
  const diagram = f.k02Diagram();
  delete diagram.after.nodes[3].anchor;
  const rejected = validateDiagram(diagram, options);
  assert.equal(rejected.ok, false);
  assert.deepEqual(codes(rejected.findings), ["unanchored_node"]);
  assert.match(
    rejected.findings[0].message,
    /decide#sent has no code location/,
  );
  const sketch = {
    ...diagram,
    provenance: {
      ...diagram.provenance,
      status: "inferred",
      method: "agent-sketch",
    },
  };
  assert.ok(validateDiagram(sketch, options).ok);
  assert.deepEqual(
    codes(validateDiagram(sketch, { ...options, derivedOnly: true }).findings),
    ["derived_only"],
  );
});

test("anchors, beats, claims, sizes and provenance are checked", (t) => {
  const { f, options } = context(t);
  const cases: [string, (d: ReturnType<typeof f.k02Diagram>) => void][] = [
    [
      "anchor_unresolved",
      (d) => (d.after.nodes[1].anchor!.contentHash = hashText("other")),
    ],
    [
      "anchor_unresolved",
      (d) =>
        (d.after.nodes[1].anchor!.context = { startLine: 900, endLine: 901 }),
    ],
    ["invalid_anchor", (d) => (d.after.nodes[1].anchor!.path = "../escape.go")],
    ["unknown_beat", (d) => (d.after.nodes[1].beatIds = ["missing"])],
    ["unknown_claim", (d) => (d.after.nodes[1].claimIds = ["C9"])],
    ["unknown_stop", (d) => (d.stopId = "K99")],
    ["missing_reason", (d) => (d.reason = " ")],
    ["invalid_provenance", (d) => (d.provenance.method = "agent-sketch")],
    ["invalid_revision", (d) => (d.provenance.revs.after = "deadbeef")],
    ["duplicate_id", (d) => d.after.nodes.push({ ...d.after.nodes[0] })],
    ["invalid_edge", (d) => (d.after.edges[0].to = "nowhere")],
    [
      "size_limit",
      (d) => {
        for (let i = 0; i < 31; i++)
          d.after.nodes.push({
            ...d.after.nodes[1],
            id: `extra${i}`,
            beatIds: [],
          });
      },
    ],
  ];
  for (const [code, mutate] of cases) {
    const diagram = f.k02Diagram();
    mutate(diagram);
    const checked = validateDiagram(diagram, options);
    assert.equal(checked.ok, false, code);
    assert.ok(
      codes(checked.findings).includes(code),
      `${code}: ${JSON.stringify(checked.findings)}`,
    );
  }
});

test("timeline needs an axis; small or misaligned drawings warn", (t) => {
  const { f, options } = context(t);
  assert.ok(validateDiagram(f.k03Timeline(), options).ok);
  const noAxis = f.k03Timeline();
  delete noAxis.after.axis;
  assert.deepEqual(codes(validateDiagram(noAxis, options).findings), [
    "invalid_axis",
  ]);
  const small = f.k02Diagram();
  small.after.nodes = small.after.nodes.slice(0, 2);
  small.after.edges = [];
  delete small.before;
  small.provenance.revs = { after: f.head };
  assert.ok(
    codes(validateDiagram(small, options).findings, "warning").includes(
      "small_diagram",
    ),
  );
  const mismatch = f.k02Diagram();
  mismatch.after.nodes[5].beatIds = ["limits"];
  assert.deepEqual(
    codes(validateDiagram(mismatch, options).findings, "warning"),
    ["beat_anchor_mismatch"],
  );
});

test("partial streams check structure without metadata or anchors", () => {
  const partial = validateDiagram(
    {
      kind: "timeline",
      title: "Attempts",
      after: {
        nodes: [],
        edges: [{ id: "w", from: "a", to: "b" }],
        axis: { unit: "s", min: 0, max: 2 },
      },
    },
    { partial: true },
  );
  assert.ok(partial.ok, JSON.stringify(partial.findings));
  assert.equal(validateDiagram({ title: "x" }, { partial: true }).ok, false);
  // Beat ids are checked for shape only until the stop is known.
  const beats = {
    kind: "flow",
    title: "Decide",
    after: {
      nodes: [{ id: "k", label: "Key?", shape: "decision", beatIds: ["key"] }],
      edges: [{ id: "e", from: "k", to: "x", beatIds: ["key"] }],
    },
  };
  assert.ok(validateDiagram(beats, { partial: true }).ok);
  const malformed = {
    ...beats,
    after: {
      ...beats.after,
      nodes: [{ ...beats.after.nodes[0], beatIds: [""] }],
    },
  };
  assert.deepEqual(
    codes(validateDiagram(malformed, { partial: true }).findings),
    ["unknown_beat"],
  );
});

test("diff marks new decisions and changed nodes with their old labels", (t) => {
  const { f } = context(t);
  const d = f.k02Diagram();
  const diff = diffGraphs(d.before, d.after);
  assert.equal(diff.diffable, true);
  for (const id of ["decide#limits", "decide#key", "decide#timeout"])
    assert.equal(diff.nodes[id].status, "new", id);
  assert.deepEqual(diff.nodes["decide#sent"], {
    status: "changed",
    was: "Connection refused or DNS?",
  });
  assert.deepEqual(diff.nodes["decide#backoff"], {
    status: "changed",
    was: "Retry once",
  });
  assert.equal(diff.edges["e-sent-no"].status, "changed");
  assert.equal(diffGraphs(undefined, d.after).diffable, false);
  // A heavy refactor shares too few ids to diff honestly.
  const refactor: Graph = {
    nodes: d.before!.nodes.map((n, i) => ({
      ...n,
      id: i ? `renamed${i}` : n.id,
    })),
    edges: [],
  };
  assert.equal(diffGraphs(refactor, d.after).diffable, false);
});

test("text descriptions follow edges and name statuses in words", (t) => {
  const { f } = context(t);
  const d = f.k02Diagram();
  const lines = describeGraph("flow", d.after, {
    diff: diffGraphs(d.before, d.after),
    claims: { C2: "contradicted" },
  });
  assert.equal(
    lines[0],
    "Send failed [changed]: → Attempts left, within deadline?",
  );
  assert.ok(
    lines.includes(
      "Has idempotency key? [new]: yes → Retry, same key; no → Read timeout?",
    ),
  );
  assert.ok(lines.includes("Retry with backoff [new; C2 contradicted]"));
  assert.ok(
    lines.includes(
      "Sent any bytes? [changed, was: Connection refused or DNS?]: no → Retry with backoff, ≤3; yes → Has idempotency key?",
    ),
  );
  const timeline = describeGraph("timeline", f.k03Timeline().after);
  assert.deepEqual(timeline.slice(0, 3), [
    "Time axis from 0s to 2s.",
    "0s–0.6s: 1 · timeout on One charge",
    "0.6s–0.8s: backoff 200ms on One charge",
  ]);
  assert.ok(
    timeline.includes("1.6s–2.2s: 3 · skipped, does not run on One charge"),
  );
  assert.match(
    ariaSummary(d as never, d.after),
    /^Flow diagram, How a failed send is classified: 10 nodes and 9 connections\. derived · classify\.go\.$/,
  );
  assert.equal(
    provenanceLabel({
      provenance: {
        ...d.provenance,
        status: "inferred",
        method: "agent-sketch",
      },
    }),
    "inferred · sketched by Kankō",
  );
  assert.equal(
    revisionLabel(d),
    `derived · ${f.base.slice(0, 7)} vs ${f.head.slice(0, 7)}`,
  );
});

test("signals recommend a flow for K02 and a skip for K05's counters", (t) => {
  const { plan, sources } = context(t);
  const stop = (id: string) => plan.stops.find((s) => s.id === id) as TourStop;
  const k02 = computeDiagramSignals(stop("K02"), sources.readSource);
  assert.equal(k02.recommendation, "draw");
  assert.equal(k02.suggestedKind, "flow");
  assert.deepEqual(
    k02.draw.map((s) => s.code),
    ["branches", "timing"],
  );
  assert.match(k02.draw[0].detail, /4 branches in Decide$/);
  const k05 = computeDiagramSignals(stop("K05"), sources.readSource);
  assert.equal(k05.recommendation, "skip");
  assert.deepEqual(k05.draw, []);
  assert.equal(k05.changedLines, 2);
  const budget = computeDiagramSignals(stop("K02"), sources.readSource, {
    existingDiagrams: 1,
    maxPerStop: 1,
  });
  assert.equal(budget.recommendation, "skip");
  assert.deepEqual(
    budget.skip.map((s) => s.code),
    ["budget"],
  );
});

test("signals see formatting-only, test-only and config-only stops", () => {
  const anchor = (path: string) => ({
    n: 1,
    role: "change" as const,
    label: "x",
    path,
    view: "diff" as const,
    change: "modified" as const,
    rev: { base: "a", head: "b" },
    side: "head" as const,
    context: { startLine: 1, endLine: 3 },
    contentHash: hashText(""),
    focus: [],
    claimRefs: [],
  });
  const read = (base: string, head: string) => () => ({ base, head });
  const formatting = computeDiagramSignals(
    { id: "s", anchors: [anchor("a.go")] },
    read("if a {\n  b()\n}\n", "if a {\n    b()\n}\n"),
  );
  assert.deepEqual(
    formatting.skip.map((s) => s.code),
    ["formatting_only"],
  );
  const tests = computeDiagramSignals(
    { id: "s", anchors: [anchor("pkg/a_test.go")] },
    read("x := 1\n", "x := 2\ny := 3\n"),
  );
  assert.deepEqual(
    tests.skip.map((s) => s.code),
    ["tests_only"],
  );
  const config = computeDiagramSignals(
    { id: "s", anchors: [anchor("config/app.yaml")] },
    read("a: 1\n", "a: 2\nb: 3\n"),
  );
  assert.deepEqual(
    config.skip.map((s) => s.code),
    ["config_only"],
  );
});

test("staleness compares anchored ranges with the current sources", (t) => {
  const { f, options, sources } = context(t);
  const checked = validateDiagram(f.k02Diagram(), options);
  assert.ok(checked.ok);
  const diagram = {
    ...checked.diagram,
    sourceHash: diagramSourceHash(checked.diagram),
  };
  assert.equal(
    diagramIsStale(diagram, sources.readSource, sources.revisions),
    false,
  );
  const changed = () => ({
    base: f.texts.CLASSIFY_BASE,
    head: f.texts.CLASSIFY_HEAD.replace("RetrySameKey", "RetryWithKey"),
  });
  assert.equal(diagramIsStale(diagram, changed, sources.revisions), true);
  assert.equal(
    diagramIsStale(
      { ...diagram, sourceHash: hashText("tampered") },
      sources.readSource,
      sources.revisions,
    ),
    true,
  );
});

test("settings read the documented defaults and bounds", () => {
  assert.deepEqual(readDiagramSettings(undefined), {
    mode: "auto",
    maxPerStop: 1,
    derivedOnly: false,
    openBeside: "ask",
  });
  assert.deepEqual(
    readDiagramSettings({
      mode: "off",
      maxPerStop: 3,
      derivedOnly: true,
      openBeside: "never",
    }),
    { mode: "off", maxPerStop: 3, derivedOnly: true, openBeside: "never" },
  );
  assert.equal(readDiagramSettings({ maxPerStop: 4 }).maxPerStop, 1);
  assert.equal(readDiagramSettings({ mode: "sometimes" }).mode, "auto");
});
