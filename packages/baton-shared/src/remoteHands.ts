// @effect-diagnostics globalTimers:off
/**
 * Remote hands (docs/baton/REMOTE_HANDS.md): a remote session asks, the desktop does. The server only brokers: it checks the
 * call is one of the allowed tools, holds it until the desktop (which owns the gate and the mouse guard) takes it, and passes
 * back the answer. Holding is a long poll, so a call reaches the desktop the moment it is made.
 */

/** What a remote session may ask for: the hands, a window picture, and a few operations on the app. */
export const REMOTE_HANDS_TOOLS: ReadonlySet<string> = new Set([
  "ui_tree",
  "click_element",
  "act_batch",
  "wait_for",
  "window_capture",
  "type_text",
  "press_keys",
  "app_version",
  "log_tail",
  "process_list",
  "process_stop",
  "app_update",
  "open_page",
]);

export const ARGS_MAX_BYTES = 20_000;
export const CALL_TIMEOUT_MS = 60_000;
/** The desktop counts as listening if it asked for work this recently. */
export const HOST_LISTENING_MS = 45_000;
const AUDIT_KEEP = 200;

export interface HandsCall {
  readonly id: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly session: string;
}

export interface HandsResult {
  readonly ok: boolean;
  readonly text?: string;
  readonly images?: ReadonlyArray<{ readonly data: string; readonly mimeType: string }>;
  readonly error?: string;
}

export interface HandsAudit {
  readonly at: number;
  readonly session: string;
  readonly tool: string;
  /** Short and never the text typed: its length only. */
  readonly what: string;
  readonly outcome: "done" | "refused" | "failed" | "timeout" | "not-listening";
  readonly ms: number;
}

/** Arguments for the log, without anything typed or secret. */
export const auditWhat = (tool: string, args: Readonly<Record<string, unknown>>): string => {
  const parts = Object.entries(args).map(([k, v]) =>
    k === "text" && typeof v === "string"
      ? `text(${v.length} chars)`
      : k === "steps" && Array.isArray(v)
        ? `steps(${v.length})`
        : `${k}=${JSON.stringify(v).slice(0, 60)}`,
  );
  return `${tool} ${parts.join(" ")}`.slice(0, 200);
};

export const createHandsBroker = (input: {
  readonly now: () => number;
  readonly newId: () => string;
  readonly callTimeoutMs?: number;
  readonly onAudit?: (entry: HandsAudit) => void;
}) => {
  const timeoutMs = input.callTimeoutMs ?? CALL_TIMEOUT_MS;
  const queue: HandsCall[] = [];
  const waiting = new Map<string, (r: HandsResult) => void>();
  let taker: ((c: HandsCall | null) => void) | null = null;
  let lastTake = Number.NEGATIVE_INFINITY;
  const audit: HandsAudit[] = [];

  const record = (entry: HandsAudit) => {
    audit.push(entry);
    if (audit.length > AUDIT_KEEP) audit.shift();
    input.onAudit?.(entry);
  };
  const connected = () => input.now() - lastTake < HOST_LISTENING_MS;

  /** The desktop's long poll: resolves with the next call, or null after `waitMs`. */
  const take = (waitMs: number): Promise<HandsCall | null> => {
    lastTake = input.now();
    const next = queue.shift();
    if (next !== undefined) return Promise.resolve(next);
    return new Promise((resolve) => {
      taker?.(null);
      const timer = setTimeout(() => {
        taker = null;
        resolve(null);
      }, waitMs);
      taker = (c) => {
        clearTimeout(timer);
        taker = null;
        lastTake = input.now();
        resolve(c);
      };
    });
  };

  const call = (
    session: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<HandsResult> => {
    const started = input.now();
    const what = auditWhat(tool, args);
    const finish = (outcome: HandsAudit["outcome"], result: HandsResult): HandsResult => {
      record({ at: started, session, tool, what, outcome, ms: input.now() - started });
      return result;
    };
    if (!REMOTE_HANDS_TOOLS.has(tool)) {
      return Promise.resolve(
        finish("refused", { ok: false, error: `${tool} is not a remote hands tool.` }),
      );
    }
    if (JSON.stringify(args).length > ARGS_MAX_BYTES) {
      return Promise.resolve(
        finish("refused", { ok: false, error: "The arguments are too large." }),
      );
    }
    if (!connected()) {
      return Promise.resolve(
        finish("not-listening", {
          ok: false,
          error: "The desktop app is not listening for remote hands.",
        }),
      );
    }
    const id = input.newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve(finish("timeout", { ok: false, error: "The desktop did not answer in time." }));
      }, timeoutMs);
      waiting.set(id, (r) => {
        clearTimeout(timer);
        resolve(finish(r.ok ? "done" : "failed", r));
      });
      const item: HandsCall = { id, tool, args, session };
      if (taker !== null) taker(item);
      else queue.push(item);
    });
  };

  const reply = (id: string, result: HandsResult): boolean => {
    const done = waiting.get(id);
    if (done === undefined) return false;
    waiting.delete(id);
    done(result);
    return true;
  };

  return { call, take, reply, connected, audit: () => [...audit] };
};

export type HandsBroker = ReturnType<typeof createHandsBroker>;

/** Ids the ops tools handed out, so `process_stop` can only stop what `process_list` showed. */
export const createHandleRegistry = <T>(newId: () => string) => {
  const items = new Map<string, T>();
  return {
    add: (value: T): string => {
      const id = newId();
      items.set(id, value);
      return id;
    },
    get: (id: string): T | undefined => items.get(id),
    clear: () => items.clear(),
  };
};
