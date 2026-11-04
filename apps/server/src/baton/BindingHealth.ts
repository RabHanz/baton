/**
 * A live thread must stay bound to the terminal session it mirrors. The decision is pure: from what the thread says
 * about itself and what the running session says, what to do this check.
 */
export interface BindingFacts {
  readonly threadId: string;
  readonly sessionId: string;
  /** The running session found by id, or null when none runs under this id. */
  readonly session: { readonly status: string | null; readonly pane: string | null } | null;
  readonly thread: {
    readonly instanceId: string;
    /** The native session id of the thread's active provider thread, if it has one. */
    readonly nativeId: string | null;
    readonly running: boolean;
  };
}

export type BindingAction =
  /** Bound to its session. */
  | { readonly kind: "ok" }
  /** No running session under this id: nothing to bind to yet. */
  | { readonly kind: "no-session" }
  /** On another provider instance (a handoff session): put it back on the live instance. */
  | { readonly kind: "rebind-instance" }
  /** On the live instance but pointing at no session or another one: point it at this session. */
  | { readonly kind: "rebind-native" }
  /** A turn is running; check again after it. */
  | { readonly kind: "wait" };

export const decideBinding = (facts: BindingFacts): BindingAction => {
  if (facts.session === null) return { kind: "no-session" };
  if (facts.thread.instanceId === "baton-live" && facts.thread.nativeId === facts.sessionId)
    return { kind: "ok" };
  if (facts.thread.running) return { kind: "wait" };
  return facts.thread.instanceId === "baton-live"
    ? { kind: "rebind-native" }
    : { kind: "rebind-instance" };
};
