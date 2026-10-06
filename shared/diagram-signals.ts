import type { SourceReader, SourceSide, TourStop } from "./types.js";
import type { DiagramKind } from "./diagram.js";

// Deterministic hints computed for each stop during tour preparation. They are
// heuristics over the stop's changed lines, not a parse; the agent makes the
// final call and writes the reason either way.

export type DrawSignalCode =
  "branches" | "call_path" | "states" | "value_flow" | "timing";
export type SkipSignalCode =
  "formatting_only" | "one_line" | "config_only" | "tests_only" | "budget";

export interface DiagramSignals {
  stopId: string;
  draw: { code: DrawSignalCode; kind: DiagramKind; detail: string }[];
  skip: { code: SkipSignalCode; detail: string }[];
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

interface Hunk {
  path: string;
  /** 0-based line indexes. */
  removed: number[];
  added: number[];
}

const BRANCH =
  /^\s*(?:\}\s*)?(?:else\s+if|elif|elsif|if|switch|case|match|when|catch|except|guard|unless|default\s*:)\b|\?\?|\s\?\s[^:]+\s:\s/;
const STATE =
  /\b\w*(?:State|Status|Phase|Stage|state|status|phase|stage)\w*\b.*(?:=|:|->|=>|\bcase\b)|\b(?:enum|iota|transition|Transition)\b/;
const TIMING =
  /retr(?:y|ies|ied)|backoff|back-off|timeout|time-out|deadline|\bttl\b|\bsleep\b|ticker|\btimer\b|setTimeout|setInterval|WithTimeout|WithDeadline|\bmutex\b|Mutex|\bLock\(|Unlock\(|semaphore|go func|\bchan\b|select\s*\{|WaitGroup|Promise\.race|\batomic\b/i;
const FUNCTION = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:func|function|def|fn)\s*(?:\([^)]*\)\s*)?\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:(?:public|private|protected|internal|static|final|override|virtual|async|abstract|readonly)\s+)*[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:throws [\w., ]+)?\{?\s*$/,
  /^\s*(?:(?:public|private|protected|static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
];
const KEYWORDS = new Set(
  "if else for while return func function def const let var true false nil null none this self err new case switch break continue range".split(
    " ",
  ),
);
const CONFIG =
  /\.(?:json|ya?ml|toml|ini|cfg|conf|env|properties|xml|lock)$|(?:^|\/)(?:\.env[\w.-]*|\.\w+rc)$/;
const TEST =
  /(?:^|\/)(?:tests?|__tests__|specs?|testdata|fixtures)\/|[._-](?:test|spec)\.\w+$|_test\.go$|(?:^|\/)test_[^/]+\.py$/;

const lines = (text: string | null) => {
  if (text === null) return [];
  const all = text.split("\n");
  if (all.at(-1) === "") all.pop();
  return all;
};

/** Line hunks after trimming the common prefix and suffix; the middle uses an
 * LCS when small enough and is treated as fully replaced otherwise. */
function hunks(path: string, base: string[], head: string[]): Hunk[] {
  let start = 0;
  while (
    start < base.length &&
    start < head.length &&
    base[start] === head[start]
  )
    start++;
  let endBase = base.length,
    endHead = head.length;
  while (
    endBase > start &&
    endHead > start &&
    base[endBase - 1] === head[endHead - 1]
  ) {
    endBase--;
    endHead--;
  }
  const a = base.slice(start, endBase),
    b = head.slice(start, endHead);
  if (!a.length && !b.length) return [];
  const range = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => from + i);
  if (a.length * b.length > 4_000_000)
    return [
      { path, removed: range(start, endBase), added: range(start, endHead) },
    ];
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const result: Hunk[] = [];
  let current: Hunk | null = null;
  let i = 0,
    j = 0;
  const open = () => (current ||= { path, removed: [], added: [] });
  const close = () => {
    if (current) result.push(current);
    current = null;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (
      j < b.length &&
      (i >= a.length || table[i][j + 1] >= table[i + 1][j])
    ) {
      open().added.push(start + j++);
    } else {
      open().removed.push(start + i++);
    }
  }
  close();
  return result;
}

function enclosingFunction(text: string[], index: number, fallback: string) {
  for (let i = index; i >= 0; i--)
    for (const pattern of FUNCTION) {
      const match = text[i].match(pattern);
      if (match && !KEYWORDS.has(match[1])) return match[1];
    }
  return fallback;
}

const component = (path: string) => {
  const parts = path.split("/");
  const skip = new Set(["src", "lib", "pkg", "internal", "app", "cmd"]);
  const first = parts.findIndex((p, i) => i < parts.length - 1 && !skip.has(p));
  return first < 0 ? "." : parts.slice(0, first + 1).join("/");
};

export function computeDiagramSignals(
  stop: Pick<TourStop, "id" | "anchors">,
  readSource: SourceReader,
  options: SignalOptions = {},
): DiagramSignals {
  const signals: DiagramSignals = {
    stopId: stop.id,
    draw: [],
    skip: [],
    recommendation: "skip",
    suggestedKind: null,
    changedLines: 0,
  };
  const changeAnchors = stop.anchors.filter((a) => a.role === "change");
  const anchors = changeAnchors.length ? changeAnchors : stop.anchors;
  const texts = new Map<string, { base: string[]; head: string[] }>();
  const selected: Hunk[] = [];
  for (const anchor of anchors) {
    if (!texts.has(anchor.path)) {
      try {
        const source = readSource(anchor);
        texts.set(anchor.path, {
          base: lines(source.base),
          head: lines(source.head),
        });
      } catch {
        continue;
      }
    }
  }
  for (const [path, text] of texts) {
    const spans = anchors
      .filter((a) => a.path === path)
      .flatMap((a) => [{ side: a.side, range: a.context }, ...(a.focus || [])]);
    const touches = (side: SourceSide, indexes: number[]) =>
      spans.some(
        (s) =>
          s.side === side &&
          indexes.some(
            (i) => i + 1 >= s.range.startLine && i + 1 <= s.range.endLine,
          ),
      );
    for (const hunk of hunks(path, text.base, text.head)) {
      // Pure insertions are attributed through the neighbouring base line.
      const baseNeighbour = hunk.removed.length
        ? hunk.removed
        : [Math.max(0, (hunk.added[0] ?? 0) - 1)];
      if (touches("head", hunk.added) || touches("base", baseNeighbour))
        selected.push(hunk);
    }
  }
  const added = selected.flatMap((h) =>
    h.added.map((i) => ({
      path: h.path,
      i,
      text: texts.get(h.path)?.head[i] || "",
    })),
  );
  const removed = selected.flatMap((h) =>
    h.removed.map((i) => ({
      path: h.path,
      i,
      text: texts.get(h.path)?.base[i] || "",
    })),
  );
  signals.changedLines = selected.reduce(
    (sum, h) => sum + Math.max(h.added.length, h.removed.length),
    0,
  );
  const draw = (code: DrawSignalCode, kind: DiagramKind, detail: string) =>
    signals.draw.push({ code, kind, detail });
  const skip = (code: SkipSignalCode, detail: string) =>
    signals.skip.push({ code, detail });

  // Branches per enclosing function; a modified condition counts once.
  const branches = new Map<string, { added: number; removed: number }>();
  for (const [list, side] of [
    [added, "added"],
    [removed, "removed"],
  ] as const)
    for (const line of list) {
      if (!BRANCH.test(line.text)) continue;
      const text = texts.get(line.path);
      const fn = enclosingFunction(
        side === "added" ? text?.head || [] : text?.base || [],
        line.i,
        line.path,
      );
      const key = `${line.path}#${fn}`;
      const count = branches.get(key) || { added: 0, removed: 0 };
      count[side]++;
      branches.set(key, count);
    }
  const [busiest] = [...branches]
    .map(([key, c]) => ({ key, n: Math.max(c.added, c.removed), c }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  if (busiest && busiest.n >= 2) {
    const fn = busiest.key.slice(busiest.key.indexOf("#") + 1);
    const verb =
      busiest.c.added && !busiest.c.removed
        ? "adds"
        : busiest.c.removed && !busiest.c.added
          ? "removes"
          : "changes";
    draw("branches", "flow", `${verb} ${busiest.n} branches in ${fn}`);
  }
  const roles = new Set(stop.anchors.map((a) => a.role));
  const components = [
    ...new Set(
      stop.anchors
        .filter((a) => ["change", "caller", "callee"].includes(a.role))
        .map((a) => component(a.path)),
    ),
  ].sort();
  if ((roles.has("caller") || roles.has("callee")) && components.length >= 3)
    draw(
      "call_path",
      "sequence",
      `the changed call path crosses ${components.length} components (${components.join(", ")})`,
    );
  const states = [...added, ...removed].filter((l) => STATE.test(l.text));
  if (states.length)
    draw(
      "states",
      "state",
      `${states.length} changed lines touch states or transitions`,
    );
  // A value assigned in changed code and read in three or more functions.
  const assigned = new Set<string>();
  for (const line of added)
    for (const match of line.text.matchAll(
      /([A-Za-z_$][\w$]{2,})\s*(?::=|=(?!=))/g,
    ))
      if (!KEYWORDS.has(match[1])) assigned.add(match[1]);
  let flow: { name: string; count: number } | null = null;
  for (const name of [...assigned].sort()) {
    const pattern = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`);
    const functions = new Set<string>();
    for (const anchor of stop.anchors) {
      const text = texts.get(anchor.path)?.head || [];
      for (
        let i = anchor.context.startLine - 1;
        i < Math.min(text.length, anchor.context.endLine);
        i++
      )
        if (pattern.test(text[i]))
          functions.add(
            `${anchor.path}#${enclosingFunction(text, i, anchor.path)}`,
          );
    }
    if (functions.size >= 3 && (!flow || functions.size > flow.count))
      flow = { name, count: functions.size };
  }
  if (flow)
    draw(
      "value_flow",
      "dataflow",
      `${flow.name} flows through ${flow.count} functions`,
    );
  const timing = [...added, ...removed].filter((l) => TIMING.test(l.text));
  if (timing.length)
    draw(
      "timing",
      "timeline",
      `${timing.length} changed lines touch retries, timeouts, deadlines, or concurrency`,
    );

  const squash = (list: { text: string }[]) =>
    list.map((l) => l.text.replace(/\s+/g, "")).join("");
  const paths = [...new Set(selected.map((h) => h.path))];
  if (!selected.length || squash(added) === squash(removed))
    skip("formatting_only", "only renames, moves, or formatting changed");
  else if (signals.changedLines <= 1) skip("one_line", "a one-line change");
  if (paths.length && paths.every((p) => CONFIG.test(p)))
    skip("config_only", "only configuration changed");
  if (paths.length && paths.every((p) => TEST.test(p)))
    skip("tests_only", "the stop only touches tests");
  const max = options.maxPerStop ?? 1;
  if ((options.existingDiagrams || 0) >= max)
    skip(
      "budget",
      `the stop already has ${options.existingDiagrams} of ${max} diagrams`,
    );
  signals.suggestedKind = signals.draw[0]?.kind || null;
  signals.recommendation =
    signals.draw.length && !signals.skip.length ? "draw" : "skip";
  return signals;
}
