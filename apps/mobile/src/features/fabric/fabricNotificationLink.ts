/**
 * Where a notification about a work session should land.
 *
 * §29 Phase 7 asks for notification deep links, and Fabric adds one case
 * upstream's thread links cannot express: **a work session whose thread has
 * ended**. That is the whole point of the object (§5.4, and the Phase 2 exit
 * criterion), and a notification that opened a thread which no longer exists
 * would be the object's first broken promise.
 *
 * So: a live thread opens the thread, and work with no live thread opens the
 * Fabric screen focused on it.
 */

/** The app's own scheme. The dev and preview builds use their own prefixes. */
const SCHEME = "t3code";

export interface FabricDeepLinkTarget {
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
export const fabricDeepLink = (target: FabricDeepLinkTarget): string =>
  target.activeThreadId === null
    ? `${SCHEME}://fabric/${encodeURIComponent(target.environmentId)}/${encodeURIComponent(target.workSessionId)}`
    : `${SCHEME}://threads/${encodeURIComponent(target.environmentId)}/${encodeURIComponent(target.activeThreadId)}`;

export interface FabricRouteParams {
  readonly environmentId: string;
  readonly workSessionId: string;
}

/**
 * Read a Fabric link back.
 *
 * Returns null for anything else — including the thread links, which the
 * existing routing already owns. A parser that claimed those would quietly take
 * over navigation it does not understand.
 */
export const parseFabricDeepLink = (url: string): FabricRouteParams | null => {
  const match = /^t3code(?:-dev|-preview)?:\/\/fabric\/([^/?#]+)\/([^/?#]+)/.exec(url.trim());
  if (match === null) return null;
  const environmentId = decodeURIComponent(match[1] ?? "");
  const workSessionId = decodeURIComponent(match[2] ?? "");
  if (environmentId.length === 0 || workSessionId.length === 0) return null;
  return { environmentId, workSessionId };
};
