// Reviewer events waiting for the agent's next kanko_await_reviewer call.
// They survive a window reload so a pin or request is never silently lost.
export interface ReviewerContext {
  stopId: string;
  beatId: string;
  mode: string;
  selectedAnchor: number | null;
}
export type ReviewerEvent =
  | {
      kind: "diagram_request";
      id: string;
      mapId: string;
      stopId: string;
      text?: string;
      replaces?: string;
      context: ReviewerContext;
    }
  | {
      kind: "diagram_feedback";
      id: string;
      mapId: string;
      diagramId: string;
      value: "not_helpful";
    }
  | {
      kind: "diagram_pin";
      id: string;
      mapId: string;
      diagramId: string;
      stopId: string;
    };

export interface EventStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void> | void;
}

const KEY = "kanko.reviewerEvents";
const LIMIT = 200;

export function createReviewerEvents(storage?: EventStorage) {
  const saved = storage?.get<unknown>(KEY);
  let queue: ReviewerEvent[] = Array.isArray(saved)
    ? (saved.filter(
        (e) => e && typeof e === "object" && typeof e.kind === "string",
      ) as ReviewerEvent[])
    : [];
  const waiters = new Set<() => void>();
  const persist = () => {
    try {
      void storage?.update(KEY, queue);
    } catch {
      /* the in-memory queue still delivers */
    }
  };
  function drain() {
    const events = queue;
    queue = [];
    persist();
    return events;
  }
  return {
    push(event: ReviewerEvent) {
      queue = [...queue, event].slice(-LIMIT);
      persist();
      for (const wake of [...waiters]) wake();
    },
    pending: () => [...queue],
    /** Return queued events, or wait up to timeoutMs for the first one. */
    take(timeoutMs = 0): Promise<ReviewerEvent[]> {
      if (queue.length || timeoutMs <= 0) return Promise.resolve(drain());
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve(drain());
        };
        const timer = setTimeout(done, timeoutMs);
        waiters.add(done);
      });
    },
    dispose() {
      for (const wake of [...waiters]) wake();
    },
  };
}
export type ReviewerEvents = ReturnType<typeof createReviewerEvents>;
