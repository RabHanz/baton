import type { AgentSessionThreadSummary } from "@t3tools/contracts";

/**
 * Sizes are the fastest way to tell two conversations apart when their titles
 * are both the model's summary of the same project, so they are rounded the way
 * a file manager rounds them rather than to a fixed precision.
 */
export function formatConversationSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** A folder's own name, which is what a project is called when it has no other. */
export function workspaceRootTitle(workspaceRoot: string): string {
  const segments = workspaceRoot.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? workspaceRoot;
}

/**
 * Why a conversation cannot be picked, or `null` when it can.
 *
 * Both reasons are visible in the row rather than discovered on failure: one is
 * already here and opening it is a different action, and one is being written to
 * right now, where a second writer would damage the only record of it.
 */
export function conversationUnavailableReason(
  thread: Pick<AgentSessionThreadSummary, "alreadyImported" | "stillWriting">,
): "already-here" | "still-running" | null {
  if (thread.alreadyImported) return "already-here";
  if (thread.stillWriting) return "still-running";
  return null;
}

export function canImportConversation(
  thread: Pick<AgentSessionThreadSummary, "alreadyImported" | "stillWriting">,
): boolean {
  return conversationUnavailableReason(thread) === null;
}
