/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Where a notification about a work session should land.
 *
 * §29 Phase 7 asks for notification deep links, and Baton adds one case
 * upstream's thread links cannot express: **a work session whose thread has
 * ended**. That is the whole point of the object (§5.4, and the Phase 2 exit
 * criterion), and a notification that opened a thread which no longer exists
 * would be the object's first broken promise.
 *
 * So: a live thread opens the thread, and work with no live thread opens the
 * Baton screen focused on it.
 */

/** The app's own scheme. The dev and preview builds use their own prefixes. */
const SCHEME = "t3code";

export interface BatonDeepLinkTarget {
  readonly environmentId: string;
  readonly workSessionId: string;
  /** The thread to open, when the work still has one running. */
  readonly activeThreadId: string | null;
}

/**
 * The URL a notification should carry.
 *
 * Path-only and scheme-prefixed, matching the agent-activity widget's existing
 * links, so one handler in `App.tsx` continues to route everything.
 */
// Legacy name (D71): the deep-link path stays fabric/ so links from older builds still route.
export const batonDeepLink = (target: BatonDeepLinkTarget): string =>
  target.activeThreadId === null
    ? `${SCHEME}://fabric/${encodeURIComponent(target.environmentId)}/${encodeURIComponent(target.workSessionId)}`
    : `${SCHEME}://threads/${encodeURIComponent(target.environmentId)}/${encodeURIComponent(target.activeThreadId)}`;

export interface BatonRouteParams {
  readonly environmentId: string;
  readonly workSessionId: string;
}

/**
 * Read a Baton link back.
 *
 * Returns null for anything else — including the thread links, which the
 * existing routing already owns. A parser that claimed those would quietly take
 * over navigation it does not understand.
 */
export const parseBatonDeepLink = (url: string): BatonRouteParams | null => {
  const match = /^t3code(?:-dev|-preview)?:\/\/(?:fabric|baton)\/([^/?#]+)\/([^/?#]+)/.exec(
    url.trim(),
  );
  if (match === null) return null;
  const environmentId = decodeURIComponent(match[1] ?? "");
  const workSessionId = decodeURIComponent(match[2] ?? "");
  if (environmentId.length === 0 || workSessionId.length === 0) return null;
  return { environmentId, workSessionId };
};
