/**
 * A thread mirrored from a running terminal session (instance `baton-live`) is answered only by that session.
 * A turn that names another provider instance would start a new session with a summary of the thread, a twin
 * that answers while the real session keeps running. That is refused here; the way back to the live instance is
 * always allowed.
 */
export const LIVE_THREAD_PREFIX = "baton-live";
export const LIVE_INSTANCE = "baton-live";

export const isLiveThreadId = (threadId: string): boolean =>
  threadId.startsWith(LIVE_THREAD_PREFIX);

/**
 * The reason a turn on this thread may not run: a live thread answers only on the live instance, so a turn that names
 * another one is refused whether the thread is still on the live instance or was already moved off it (a handoff
 * session is never started or woken again; Retire handoff session puts the thread back).
 */
export const liveThreadSwitchRefusal = (input: {
  readonly threadId: string;
  readonly currentInstance: string;
  readonly targetInstance: string;
}): string | null =>
  isLiveThreadId(input.threadId) && input.targetInstance !== LIVE_INSTANCE
    ? input.currentInstance === LIVE_INSTANCE
      ? "This thread belongs to a running terminal session and is answered only by it. Tessaya will not start a new session with a summary here. Continue in a new thread if you want that."
      : "This thread is answered by a handoff session, which Tessaya will not wake. Retire the handoff session, or switch the thread back to its live session."
    : null;

export interface Answerer {
  /** Who actually answers this thread's messages. */
  readonly harness: "herdr-session" | "t3-hosted";
  /** True when a mirrored live thread is being answered by a new T3-hosted session instead of its own. */
  readonly handedOff: boolean;
  readonly line: string;
}

/** The model, effort, account and harness that answer a thread, in one line for its header. */
export const describeAnswerer = (input: {
  readonly threadId: string;
  readonly instanceId: string;
  readonly model: string;
  readonly effort?: string | null;
  readonly account?: string | null;
}): Answerer => {
  const live = input.instanceId === LIVE_INSTANCE;
  const harness = live ? "herdr-session" : "t3-hosted";
  const session = isLiveThreadId(input.threadId)
    ? input.threadId.replace(/^[^:]*:/, "").slice(0, 8)
    : null;
  const parts = [
    live ? "Terminal session" : "T3-hosted session",
    session === null ? null : session,
    input.model,
    input.effort ? input.effort : null,
    input.account ? input.account : null,
  ].filter((part): part is string => part !== null && part !== "");
  return {
    harness,
    handedOff: !live && isLiveThreadId(input.threadId),
    line: parts.join(" · "),
  };
};
