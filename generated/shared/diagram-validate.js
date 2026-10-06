// Generated from TypeScript. Run npm run runtime:build in editor-extension.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagramSourceHash = diagramSourceHash;
exports.diagramIsStale = diagramIsStale;
exports.validateDiagram = validateDiagram;
exports.hasDiagramErrors = hasDiagramErrors;
const node_crypto_1 = require("node:crypto");
const tour_js_1 = require("./tour.js");
const diagram_js_1 = require("./diagram.js");
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value, max = 500) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const ID = /^[\w.:#@/+-]{1,128}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const positive = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
/** Hash of every anchored range; independent of revision ids, so unchanged
 * code at a new head stays current. */
function diagramSourceHash(diagram) {
  const parts = (0, diagram_js_1.diagramAnchors)(diagram)
    .map(
      (a) =>
        `${a.path}\0${a.side}\0${a.context.startLine}-${a.context.endLine}\0${a.contentHash}`,
    )
    .sort();
  return `sha256:${(0, node_crypto_1.createHash)("sha256")
    .update([...new Set(parts)].join("\n"))
    .digest("hex")}`;
}
/** Whether any anchored range no longer matches the given sources. */
function diagramIsStale(diagram, readSource, revisions) {
  if (diagramSourceHash(diagram) !== diagram.sourceHash) return true;
  const cache = new Map();
  for (const anchor of (0, diagram_js_1.diagramAnchors)(diagram)) {
    if (!cache.has(anchor.path))
      try {
        cache.set(
          anchor.path,
          readSource({ path: anchor.path, rev: revisions }),
        );
      } catch {
        cache.set(anchor.path, null);
      }
    const source = cache.get(anchor.path);
    const text = source
      ? (0, tour_js_1.rangeText)(source[anchor.side], anchor.context)
      : null;
    if (text === null || (0, tour_js_1.hashText)(text) !== anchor.contentHash)
      return true;
  }
  return false;
}
function validateDiagram(input, options = {}) {
  const findings = [];
  const error = (code, location, message) =>
    findings.push({ severity: "error", code, location, message });
  const warn = (code, location, message) =>
    findings.push({ severity: "warning", code, location, message });
  if (!object(input)) {
    error("invalid_diagram", "diagram", "A diagram must be an object.");
    return { ok: false, diagram: null, findings };
  }
  const diagram = structuredClone(input);
  if (!diagram_js_1.DIAGRAM_KINDS.some((k) => k === diagram.kind))
    error(
      "invalid_kind",
      "kind",
      `Choose a kind: ${diagram_js_1.DIAGRAM_KINDS.join(", ")}.`,
    );
  // A stream may omit metadata until its final patch.
  const absent = (key) => options.partial && diagram[key] === undefined;
  if (!nonempty(diagram.title, 120))
    error(
      "invalid_title",
      "title",
      "Provide a title of at most 120 characters.",
    );
  const stop = options.stops?.find((s) => s.id === diagram.stopId);
  if (
    !absent("stopId") &&
    (!nonempty(diagram.stopId, 200) || (options.stops && !stop))
  )
    error(
      "unknown_stop",
      "stopId",
      "Attach the diagram to a stop in the current tour.",
    );
  if (
    !absent("origin") &&
    diagram.origin !== "auto" &&
    diagram.origin !== "requested"
  )
    error("invalid_origin", "origin", "Origin must be auto or requested.");
  if (!absent("reason") && !nonempty(diagram.reason, 300))
    error(
      "missing_reason",
      "reason",
      "Explain in one plain sentence why this change needs a picture.",
    );
  for (const key of ["replaces", "detourId"])
    if (diagram[key] !== undefined && !nonempty(diagram[key], 200))
      error("invalid_diagram", key, `${key} must be a non-empty string.`);
  const provenance = diagram.provenance;
  let derived = false;
  if (absent("provenance")) {
    // Checked on the final patch.
  } else if (
    !object(provenance) ||
    (provenance.status !== "derived" && provenance.status !== "inferred") ||
    !["static-analysis", "trace", "agent-sketch"].includes(
      String(provenance.method),
    ) ||
    (provenance.status === "inferred") !==
      (provenance.method === "agent-sketch")
  )
    error(
      "invalid_provenance",
      "provenance",
      "Use derived with static-analysis or trace, or inferred with agent-sketch.",
    );
  else {
    derived = provenance.status === "derived";
    if (
      !Array.isArray(provenance.sources) ||
      provenance.sources.some(
        (s) =>
          !object(s) ||
          !(nonempty(s.path) || nonempty(s.symbol) || nonempty(s.traceId)) ||
          (s.path !== undefined && !(0, tour_js_1.validPath)(s.path)),
      ) ||
      (derived && !provenance.sources.length)
    )
      error(
        "invalid_provenance",
        "provenance.sources",
        "List the files, symbols, or trace ids the diagram came from.",
      );
    if (options.derivedOnly && !derived)
      error(
        "derived_only",
        "provenance.status",
        "Sketched diagrams are turned off; derive this one from code or a trace.",
      );
    const revs = provenance.revs;
    if (!object(revs) || !nonempty(revs.after))
      error(
        "invalid_revision",
        "provenance.revs",
        "Provide the after revision.",
      );
    else {
      if (revs.before !== undefined && !nonempty(revs.before))
        error(
          "invalid_revision",
          "provenance.revs.before",
          "Provide a revision id.",
        );
      if (options.revisions && revs.after !== options.revisions.head)
        error(
          "invalid_revision",
          "provenance.revs.after",
          "Use the review map's pinned head revision.",
        );
      if (
        options.revisions &&
        revs.before !== undefined &&
        revs.before !== options.revisions.base
      )
        error(
          "invalid_revision",
          "provenance.revs.before",
          "Use the review map's pinned base revision.",
        );
      if (diagram.before !== undefined && revs.before === undefined)
        error(
          "invalid_revision",
          "provenance.revs.before",
          "A before graph needs its revision.",
        );
    }
  }
  const beatIds = new Set((stop?.beats || []).map((b) => b.id));
  const claimIds = options.claims
    ? new Set(options.claims.map((c) => c.id))
    : null;
  const sources = new Map();
  const checkAnchor = (anchor, loc) => {
    if (
      !object(anchor) ||
      !(0, tour_js_1.validPath)(anchor.path) ||
      (anchor.side !== "base" && anchor.side !== "head") ||
      !object(anchor.context) ||
      !positive(anchor.context.startLine) ||
      !positive(anchor.context.endLine) ||
      anchor.context.endLine < anchor.context.startLine ||
      typeof anchor.contentHash !== "string" ||
      !HASH.test(anchor.contentHash) ||
      (anchor.symbol !== undefined && !nonempty(anchor.symbol)) ||
      (anchor.rev !== undefined &&
        (!object(anchor.rev) ||
          !nonempty(anchor.rev.base) ||
          !nonempty(anchor.rev.head)))
    ) {
      error(
        "invalid_anchor",
        loc,
        "An anchor needs a repository path, base/head side, 1-based context, and sha256 contentHash.",
      );
      return;
    }
    if (
      options.revisions &&
      object(anchor.rev) &&
      (anchor.rev.base !== options.revisions.base ||
        anchor.rev.head !== options.revisions.head)
    ) {
      error(
        "invalid_revision",
        `${loc}.rev`,
        "Use the review map's pinned revisions.",
      );
      return;
    }
    if (options.revisions) anchor.rev = { ...options.revisions };
    if (!options.readSource || !options.revisions) return;
    if (!sources.has(anchor.path))
      try {
        sources.set(
          anchor.path,
          options.readSource({ path: anchor.path, rev: options.revisions }),
        );
      } catch (e) {
        sources.set(anchor.path, e);
      }
    const source = sources.get(anchor.path);
    if (source instanceof Error || !source) {
      error(
        "anchor_unresolved",
        loc,
        `Cannot read ${anchor.path}: ${source instanceof Error ? source.message : "missing"}.`,
      );
      return;
    }
    const text = (0, tour_js_1.rangeText)(source[anchor.side], anchor.context);
    if (text === null)
      error(
        "anchor_unresolved",
        `${loc}.context`,
        `Lines ${anchor.context.startLine}–${anchor.context.endLine} do not exist in ${anchor.path} on the ${anchor.side} side.`,
      );
    else if ((0, tour_js_1.hashText)(text) !== anchor.contentHash)
      error(
        "anchor_unresolved",
        `${loc}.contentHash`,
        `The anchored lines in ${anchor.path} changed; inspect the source and regenerate the hash.`,
      );
  };
  const checkGraph = (graph, loc) => {
    if (
      !object(graph) ||
      !Array.isArray(graph.nodes) ||
      !Array.isArray(graph.edges) ||
      (!graph.nodes.length && !options.partial)
    ) {
      error("invalid_graph", loc, "A graph needs nodes and edges arrays.");
      return;
    }
    if (graph.nodes.length > diagram_js_1.DIAGRAM_LIMITS.expanded)
      error(
        "size_limit",
        `${loc}.nodes`,
        `Diagrams are limited to ${diagram_js_1.DIAGRAM_LIMITS.expanded} nodes; narrow it to one question.`,
      );
    const laneIds = new Set();
    if (graph.lanes !== undefined) {
      if (!Array.isArray(graph.lanes))
        error("invalid_lane", `${loc}.lanes`, "Lanes must be an array.");
      else
        graph.lanes.forEach((lane, i) => {
          if (
            !object(lane) ||
            !nonempty(lane.id) ||
            !ID.test(lane.id) ||
            !nonempty(lane.label, 80) ||
            laneIds.has(lane.id)
          )
            error(
              "invalid_lane",
              `${loc}.lanes[${i}]`,
              "Each lane needs a unique id and a label.",
            );
          else laneIds.add(lane.id);
        });
    }
    if (graph.axis !== undefined) {
      const axis = graph.axis;
      if (
        !object(axis) ||
        (axis.unit !== "ms" && axis.unit !== "s") ||
        !finite(axis.min) ||
        !finite(axis.max) ||
        axis.max <= axis.min ||
        (axis.marks !== undefined &&
          (!Array.isArray(axis.marks) ||
            axis.marks.some(
              (m) =>
                !object(m) ||
                !finite(m.at) ||
                !nonempty(m.label, 80) ||
                (m.kind !== undefined &&
                  m.kind !== "deadline" &&
                  m.kind !== "event"),
            )))
      )
        error(
          "invalid_axis",
          `${loc}.axis`,
          "An axis needs ms or s, min < max, and labeled marks.",
        );
    } else if (diagram.kind === "timeline" && !options.partial)
      error(
        "invalid_axis",
        `${loc}.axis`,
        "Timeline diagrams need a time axis.",
      );
    const nodeIds = new Set();
    const perBeat = new Map();
    graph.nodes.forEach((node, i) => {
      const nloc = `${loc}.nodes[${i}]`;
      if (!object(node)) {
        error("invalid_node", nloc, "A node must be an object.");
        return;
      }
      if (!nonempty(node.id) || !ID.test(node.id))
        error(
          "invalid_node",
          `${nloc}.id`,
          "Use a stable id of letters, digits, and .:#@/+-_.",
        );
      else if (nodeIds.has(node.id))
        error(
          "duplicate_id",
          `${nloc}.id`,
          `Node id ${node.id} is used twice.`,
        );
      else nodeIds.add(node.id);
      if (!nonempty(node.label, 80))
        error(
          "invalid_node",
          `${nloc}.label`,
          "Give the node a label of at most 80 characters.",
        );
      if (node.sublabel !== undefined && !nonempty(node.sublabel, 120))
        error(
          "invalid_node",
          `${nloc}.sublabel`,
          "A sublabel must be short text.",
        );
      if (!diagram_js_1.NODE_SHAPES.some((s) => s === node.shape))
        error(
          "invalid_node",
          `${nloc}.shape`,
          `Choose a shape: ${diagram_js_1.NODE_SHAPES.join(", ")}.`,
        );
      if (node.span !== undefined || node.shape === "span") {
        const span = node.span;
        if (
          !object(span) ||
          !nonempty(span.lane) ||
          (laneIds.size > 0 && !laneIds.has(span.lane)) ||
          !finite(span.start) ||
          !finite(span.end) ||
          span.end < span.start ||
          (span.style !== undefined &&
            span.style !== "solid" &&
            span.style !== "ghost")
        )
          error(
            "invalid_span",
            `${nloc}.span`,
            "A span needs a known lane and start ≤ end.",
          );
      }
      for (const [key, known, code] of [
        ["beatIds", beatIds, "unknown_beat"],
        ["claimIds", claimIds, "unknown_claim"],
      ]) {
        const ids = node[key];
        if (ids === undefined) continue;
        if (
          !Array.isArray(ids) ||
          ids.some((id) => !nonempty(id) || (known && !known.has(id)))
        )
          error(
            code,
            `${nloc}.${key}`,
            key === "beatIds"
              ? "Reference beats of this stop."
              : "Reference existing claims.",
          );
        else if (key === "beatIds")
          for (const id of ids) perBeat.set(id, (perBeat.get(id) || 0) + 1);
      }
      if (node.anchor !== undefined) checkAnchor(node.anchor, `${nloc}.anchor`);
      else if (derived && !options.partial)
        error(
          "unanchored_node",
          `${nloc}.anchor`,
          `A derived diagram must anchor every node; ${String(node.id)} has no code location.`,
        );
    });
    const edgeIds = new Set();
    graph.edges.forEach((edge, i) => {
      const eloc = `${loc}.edges[${i}]`;
      if (!object(edge) || !nonempty(edge.id) || !ID.test(edge.id)) {
        error("invalid_edge", eloc, "Each edge needs a stable id.");
        return;
      }
      if (edgeIds.has(edge.id))
        error(
          "duplicate_id",
          `${eloc}.id`,
          `Edge id ${edge.id} is used twice.`,
        );
      edgeIds.add(edge.id);
      if (
        typeof edge.from !== "string" ||
        typeof edge.to !== "string" ||
        (!options.partial && (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)))
      )
        error(
          "invalid_edge",
          eloc,
          "Edges must connect nodes of the same graph.",
        );
      if (edge.label !== undefined && !nonempty(edge.label, 80))
        error(
          "invalid_edge",
          `${eloc}.label`,
          "An edge label must be short text.",
        );
      if (
        edge.kind !== undefined &&
        !diagram_js_1.EDGE_KINDS.some((k) => k === edge.kind)
      )
        error(
          "invalid_edge",
          `${eloc}.kind`,
          `Choose a kind: ${diagram_js_1.EDGE_KINDS.join(", ")}.`,
        );
      if (
        edge.order !== undefined &&
        !(Number.isInteger(edge.order) && Number(edge.order) >= 0)
      )
        error(
          "invalid_edge",
          `${eloc}.order`,
          "Order must be a non-negative integer.",
        );
      if (
        edge.beatIds !== undefined &&
        (!Array.isArray(edge.beatIds) ||
          edge.beatIds.some((id) => !nonempty(id) || !beatIds.has(id)))
      )
        error(
          "unknown_beat",
          `${eloc}.beatIds`,
          "Reference beats of this stop.",
        );
    });
    for (const [beat, count] of perBeat)
      if (count > diagram_js_1.DIAGRAM_LIMITS.beatNodes)
        warn(
          "beat_node_budget",
          `${loc}.nodes`,
          `Beat ${beat} highlights ${count} nodes; map each beat to at most ${diagram_js_1.DIAGRAM_LIMITS.beatNodes}.`,
        );
    if (!options.partial && graph.nodes.length > 0 && graph.nodes.length < 4)
      warn(
        "small_diagram",
        `${loc}.nodes`,
        "Fewer than 4 nodes rarely beats the code itself; consider skipping.",
      );
  };
  if (diagram.after === undefined && options.partial)
    diagram.after = { nodes: [], edges: [] };
  checkGraph(diagram.after, "after");
  if (diagram.before !== undefined) checkGraph(diagram.before, "before");
  if (findings.some((f) => f.severity === "error"))
    return { ok: false, diagram: null, findings };
  const valid = diagram;
  // A beat's highlighted node should be what the editor shows for that beat.
  if (stop && valid.after.nodes.length)
    for (const node of valid.after.nodes) {
      if (!node.anchor || !node.beatIds) continue;
      const anchor = node.anchor;
      for (const beatId of node.beatIds) {
        const beat = stop.beats.find((b) => b.id === beatId);
        const shown = (beat?.active || []).flatMap((n) =>
          stop.anchors.filter((a) => a.n === n),
        );
        const overlaps = shown.some(
          (a) =>
            a.path === anchor.path &&
            [{ side: a.side, range: a.context }, ...(a.focus || [])].some(
              (span) =>
                span.side === anchor.side &&
                span.range.startLine <= anchor.context.endLine &&
                anchor.context.startLine <= span.range.endLine,
            ),
        );
        if (!overlaps)
          warn(
            "beat_anchor_mismatch",
            `after.nodes.${node.id}.beatIds`,
            `Beat ${beatId} does not show the lines anchored by node ${node.id}; the diagram and editor would disagree.`,
          );
      }
    }
  return { ok: true, diagram: valid, findings };
}
function hasDiagramErrors(findings) {
  return findings.some((f) => f.severity === "error");
}
