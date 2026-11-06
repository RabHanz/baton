/** Where the window may send another server's memory-sync credential (MEMORY.md section 6). */

const isPrivateTailnet = (host: string): boolean => {
  const parts = host.split(".").map(Number);
  // 100.64.0.0/10, the range Tailscale gives its machines.
  return parts.length === 4 && parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
};

const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "[::1]" || host.startsWith("127.");

/**
 * That server's URL for `path`, keeping any base path a relay puts it under. Null when the credential must not go
 * there: plain http is refused unless it stays on this machine or the tailnet.
 */
export const syncPeerUrl = (base: string, path: string): URL | null => {
  const root = new URL(base.endsWith("/") ? base : `${base}/`);
  if (
    root.protocol !== "https:" &&
    !(root.protocol === "http:" && (isLoopback(root.hostname) || isPrivateTailnet(root.hostname)))
  )
    return null;
  return new URL(path.replace(/^\//, ""), root);
};

/** A credential is only ever sent back to the origin that issued it. */
export const sameSyncOrigin = (stored: string, url: URL): boolean => stored === url.origin;

/** What a failed pairing or sync call means, in his words. */
export const syncFailureLine = (status: number): string =>
  status === 404 || status === 502
    ? `That server could not be reached through its relay (${status}). Try again when it is online.`
    : status === 401 || status === 403
      ? "That server no longer accepts this computer's sync credential. Pair it again."
      : "That code did not work. Make a new one on that machine and try again.";
