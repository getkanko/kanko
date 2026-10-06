// The payments retry change from the diagrams spec: stop K02 adds branches to
// Decide in payments/retry/classify.go, K03 changes the retry policy, and K05
// only adds counters.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ReviewMapService } from "../generated/mcp/lib/review-map/service.js";
import { hashText } from "../generated/shared/tour.js";
import type { DiagramInput } from "../generated/shared/diagram.js";

const CLASSIFY_BASE = `package retry

import "errors"

// Decision is what to do with a failed send.
type Decision int

// Decide classifies a failed send.
func (c *Classifier) Decide(err error, req *Request) Decision {
	if connectionRefused(err) || dnsFailure(err) {
		return RetryOnce
	}
	return Fail
}
`;

const CLASSIFY_HEAD = `package retry

import "errors"

// Decision is what to do with a failed send.
type Decision int

// Decide classifies a failed send.
func (c *Classifier) Decide(err error, req *Request, attempt int) Decision {
	if attempt >= c.maxAttempts || c.deadlineExceeded(req) {
		return Fail
	}
	if !sentAnyBytes(err) {
		return RetryWithBackoff
	}
	if req.IdempotencyKey != "" {
		return RetrySameKey
	}
	if errors.Is(err, ErrReadTimeout) {
		// D4: read timeouts are retryable
		return RetryWithBackoff
	}
	return Fail
}
`;

const POLICY_BASE = `package retry

const maxAttempts = 1
`;
const POLICY_HEAD = `package retry

import "time"

const maxAttempts = 3
const perTryTimeout = 600 * time.Millisecond
const backoff = 200 * time.Millisecond
`;
const DEADLINE = `package retry

import "time"

const chargeDeadline = 2 * time.Second
`;
const METRICS_BASE = `package retry

var sendsTotal = metrics.NewCounter("sends_total")
`;
const METRICS_HEAD = `package retry

var sendsTotal = metrics.NewCounter("sends_total")
var classifiedTotal = metrics.NewCounter("classified_total")
var failedTotal = metrics.NewCounter("failed_total")
`;

export const actor = { kind: "agent", id: "test" };
const provenance = [{ kind: "repository-observed", source: { type: "test" } }];

export function lines(text: string, start: number, end: number) {
  return text
    .split("\n")
    .slice(start - 1, end)
    .join("\n");
}
/** The 1-based line of the first line containing `needle`. */
export function lineOf(text: string, needle: string) {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`missing ${needle}`);
  return index + 1;
}

export function paymentsFixture(cleanup: (fn: () => void) => void) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "kanko-diagrams-")),
  );
  cleanup(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "repo");
  fs.mkdirSync(path.join(workspace, "payments/retry"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", workspace, ...args], {
      encoding: "utf8",
    }).trim();
  const write = (name: string, text: string) =>
    fs.writeFileSync(path.join(workspace, name), text);
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  write("payments/retry/classify.go", CLASSIFY_BASE);
  write("payments/retry/policy.go", POLICY_BASE);
  write("payments/retry/deadline.go", DEADLINE);
  write("payments/retry/metrics.go", METRICS_BASE);
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  write("payments/retry/classify.go", CLASSIFY_HEAD);
  write("payments/retry/policy.go", POLICY_HEAD);
  write("payments/retry/metrics.go", METRICS_HEAD);
  git("add", ".");
  git("commit", "-qm", "head");
  const head = git("rev-parse", "HEAD");
  const service = new ReviewMapService({ root: path.join(root, "state") });
  const opened = service.open({
    workspace,
    selection: { kind: "committed", base, head },
    actor,
  });
  if (!("mapId" in opened)) throw new Error("expected a new map");
  const mapId = opened.mapId;
  const rev = { base, head };
  const classify = "payments/retry/classify.go";
  const decide = lineOf(CLASSIFY_HEAD, "func (c *Classifier) Decide");
  const spans = {
    limits: [lineOf(CLASSIFY_HEAD, "attempt >= c.maxAttempts"), 0],
    bytes: [lineOf(CLASSIFY_HEAD, "!sentAnyBytes"), 0],
    key: [lineOf(CLASSIFY_HEAD, "req.IdempotencyKey"), 0],
    timeout: [lineOf(CLASSIFY_HEAD, "errors.Is(err, ErrReadTimeout)"), 0],
  };
  spans.limits[1] = spans.limits[0] + 2;
  spans.bytes[1] = spans.bytes[0] + 2;
  spans.key[1] = spans.key[0] + 2;
  spans.timeout[1] = spans.timeout[0] + 3;
  const anchorFor = (
    pathName: string,
    text: string,
    start: number,
    end: number,
    extra: Record<string, unknown> = {},
  ) => ({
    path: pathName,
    side: "head" as const,
    context: { startLine: start, endLine: end },
    contentHash: hashText(lines(text, start, end)),
    ...extra,
  });
  const stopAnchor = (
    n: number,
    label: string,
    pathName: string,
    text: string,
    start: number,
    end: number,
    change = "modified",
  ) => ({
    n,
    role: "change",
    label,
    view: "diff",
    change,
    rev,
    ...anchorFor(pathName, text, start, end),
  });
  const k02 = {
    id: "K02",
    title: "Idempotency boundary",
    type: "context",
    risk: "high",
    anchors: [
      stopAnchor(
        1,
        "Attempt limits",
        classify,
        CLASSIFY_HEAD,
        ...(spans.limits as [number, number]),
      ),
      stopAnchor(
        2,
        "Bytes sent check",
        classify,
        CLASSIFY_HEAD,
        ...(spans.bytes as [number, number]),
      ),
      stopAnchor(
        3,
        "Idempotency key",
        classify,
        CLASSIFY_HEAD,
        ...(spans.key as [number, number]),
      ),
      stopAnchor(
        4,
        "Read timeout",
        classify,
        CLASSIFY_HEAD,
        ...(spans.timeout as [number, number]),
      ),
    ],
    beats: [
      { id: "limits", narration: "Limits come first in {{a:1}}.", active: [1] },
      {
        id: "key",
        narration: "Keyed requests retry with the same key in {{a:3}}.",
        active: [3],
      },
      {
        id: "timeout",
        narration: "Read timeouts retry in {{a:4}}.",
        active: [4],
      },
      {
        id: "fallthrough",
        narration: "Everything else fails, see {{a:2}}.",
        active: [2],
      },
    ],
  };
  const policy = "payments/retry/policy.go";
  const k03 = {
    id: "K03",
    title: "Retry policy and deadline",
    type: "context",
    risk: "medium",
    anchors: [
      stopAnchor(1, "Retry policy", policy, POLICY_HEAD, 5, 7),
      {
        ...stopAnchor(
          2,
          "Charge deadline",
          "payments/retry/deadline.go",
          DEADLINE,
          5,
          5,
          "unchanged",
        ),
        role: "context",
        view: "head",
      },
    ],
    beats: [
      {
        id: "policy",
        narration: "Three tries in {{a:1}} against {{a:2}}.",
        active: [1, 2],
      },
    ],
  };
  const metrics = "payments/retry/metrics.go";
  const k05 = {
    id: "K05",
    title: "Metrics",
    type: "context",
    risk: "low",
    anchors: [stopAnchor(1, "New counters", metrics, METRICS_HEAD, 4, 5)],
    beats: [
      { id: "counters", narration: "Two counters in {{a:1}}.", active: [1] },
    ],
  };
  const applied = service.apply({
    workspace,
    mapId,
    expectedRevision: opened.aggregateRevision,
    actor,
    commands: [
      {
        type: "AddClaim",
        claim: {
          id: "C2",
          statement: "Read timeouts without a key are safe to retry.",
          truthStatus: "inferred",
          disposition: "contradicted",
          provenance,
        },
      },
      {
        type: "CreateTourPlan",
        presentationVersion: 2,
        title: "Payments retry",
        stops: [k02, k03, k05],
      },
    ],
  });
  const node = (
    id: string,
    label: string,
    shape: string,
    span: number[] | null,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    label,
    shape,
    ...(span
      ? { anchor: anchorFor(classify, CLASSIFY_HEAD, span[0], span[1]) }
      : {}),
    ...extra,
  });
  const baseDecide = lineOf(CLASSIFY_BASE, "func (c *Classifier) Decide");
  const baseCheck = lineOf(CLASSIFY_BASE, "connectionRefused");
  const baseAnchor = (start: number, end: number) => ({
    path: classify,
    side: "base" as const,
    context: { startLine: start, endLine: end },
    contentHash: hashText(lines(CLASSIFY_BASE, start, end)),
  });
  /** The K02 flow diagram from the spec: three new decisions, one changed
   * decision and one changed outcome. */
  const k02Diagram = (overrides: Partial<DiagramInput> = {}): DiagramInput =>
    ({
      kind: "flow",
      title: "How a failed send is classified",
      stopId: "K02",
      origin: "auto",
      reason: "The stop adds 3 branches to one function.",
      provenance: {
        status: "derived",
        method: "static-analysis",
        sources: [{ path: classify, symbol: "Decide" }],
        revs: { before: base, after: head },
      },
      before: {
        nodes: [
          {
            id: "decide#start",
            label: "Send failed",
            shape: "start",
            anchor: baseAnchor(baseDecide, baseDecide),
          },
          {
            id: "decide#sent",
            label: "Connection refused or DNS?",
            shape: "decision",
            anchor: baseAnchor(baseCheck, baseCheck),
          },
          {
            id: "decide#backoff",
            label: "Retry once",
            shape: "terminal",
            anchor: baseAnchor(baseCheck + 1, baseCheck + 1),
          },
          {
            id: "decide#fail",
            label: "Fail to caller",
            shape: "terminal",
            anchor: baseAnchor(baseCheck + 3, baseCheck + 3),
          },
        ],
        edges: [
          { id: "e-start", from: "decide#start", to: "decide#sent" },
          {
            id: "e-sent-no",
            from: "decide#sent",
            to: "decide#backoff",
            label: "yes",
          },
          { id: "e-fall", from: "decide#sent", to: "decide#fail", label: "no" },
        ],
      },
      after: {
        nodes: [
          node("decide#start", "Send failed", "start", [decide, decide]),
          node(
            "decide#limits",
            "Attempts left, within deadline?",
            "decision",
            spans.limits,
            { beatIds: ["limits"] },
          ),
          node(
            "decide#limits-fail",
            "Fail to caller",
            "terminal",
            spans.limits,
            { beatIds: ["limits"] },
          ),
          node("decide#sent", "Sent any bytes?", "decision", spans.bytes, {
            beatIds: ["fallthrough"],
          }),
          node(
            "decide#backoff",
            "Retry with backoff, ≤3",
            "terminal",
            spans.bytes,
          ),
          node("decide#key", "Has idempotency key?", "decision", spans.key, {
            beatIds: ["key"],
          }),
          node("decide#same-key", "Retry, same key", "terminal", spans.key, {
            beatIds: ["key"],
          }),
          node("decide#timeout", "Read timeout?", "decision", spans.timeout, {
            beatIds: ["timeout"],
          }),
          node(
            "decide#timeout-retry",
            "Retry with backoff",
            "terminal",
            spans.timeout,
            { beatIds: ["timeout"], claimIds: ["C2"] },
          ),
          node("decide#fail", "Fail to caller", "terminal", [
            spans.timeout[1] + 1,
            spans.timeout[1] + 1,
          ]),
        ],
        edges: [
          { id: "e-start", from: "decide#start", to: "decide#limits" },
          {
            id: "e-limits-no",
            from: "decide#limits",
            to: "decide#limits-fail",
            label: "no",
          },
          {
            id: "e-limits-yes",
            from: "decide#limits",
            to: "decide#sent",
            label: "yes",
          },
          {
            id: "e-sent-no",
            from: "decide#sent",
            to: "decide#backoff",
            label: "no",
          },
          {
            id: "e-sent-yes",
            from: "decide#sent",
            to: "decide#key",
            label: "yes",
          },
          {
            id: "e-key-yes",
            from: "decide#key",
            to: "decide#same-key",
            label: "yes",
          },
          {
            id: "e-key-no",
            from: "decide#key",
            to: "decide#timeout",
            label: "no",
          },
          {
            id: "e-timeout-yes",
            from: "decide#timeout",
            to: "decide#timeout-retry",
            label: "yes",
          },
          {
            id: "e-fall",
            from: "decide#timeout",
            to: "decide#fail",
            label: "no",
          },
        ],
      },
      ...overrides,
    }) as DiagramInput;
  /** A requested timeline for K03, as drawn in a detour. */
  const k03Timeline = (): DiagramInput =>
    ({
      kind: "timeline",
      title: "Attempts vs deadline",
      stopId: "K03",
      origin: "requested",
      reason: "The reviewer asked how the attempt limit and deadline interact.",
      provenance: {
        status: "derived",
        method: "static-analysis",
        sources: [{ path: policy }, { path: "payments/retry/deadline.go" }],
        revs: { after: head },
      },
      after: {
        lanes: [{ id: "charge", label: "One charge" }],
        axis: {
          unit: "s",
          min: 0,
          max: 2,
          marks: [
            { at: 2, label: "deadline 2.0s", kind: "deadline" },
            { at: 1.4, label: "Fail at 1.4s", kind: "event" },
          ],
        },
        nodes: [
          {
            id: "try1",
            label: "1 · timeout",
            shape: "span",
            span: { lane: "charge", start: 0, end: 0.6 },
            anchor: anchorFor(policy, POLICY_HEAD, 6, 6),
          },
          {
            id: "try2",
            label: "2 · timeout",
            shape: "span",
            span: { lane: "charge", start: 0.8, end: 1.4 },
            anchor: anchorFor(policy, POLICY_HEAD, 6, 6),
          },
          {
            id: "try3",
            label: "3 · skipped",
            shape: "span",
            span: { lane: "charge", start: 1.6, end: 2.2, style: "ghost" },
            anchor: anchorFor("payments/retry/deadline.go", DEADLINE, 5, 5),
          },
          {
            id: "backoff",
            label: "backoff 200ms",
            shape: "span",
            span: { lane: "charge", start: 0.6, end: 0.8 },
            anchor: anchorFor(policy, POLICY_HEAD, 7, 7),
          },
        ],
        edges: [
          { id: "w1", from: "try1", to: "try2", kind: "wait", label: "200ms" },
          { id: "w2", from: "try2", to: "try3", kind: "wait", label: "200ms" },
        ],
      },
    }) as DiagramInput;
  return {
    root,
    workspace,
    git,
    write,
    base,
    head,
    service,
    mapId,
    revision: applied.aggregateRevision,
    applied,
    spans,
    texts: {
      CLASSIFY_HEAD,
      CLASSIFY_BASE,
      POLICY_HEAD,
      DEADLINE,
      METRICS_HEAD,
    },
    anchorFor,
    k02Diagram,
    k03Timeline,
  };
}
