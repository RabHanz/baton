/* oxlint-disable t3code/no-low-value-comments -- Baton file (D82) */
/**
 * Reading a live Claude Code transcript as conversation messages (D83).
 *
 * The same rule upstream's agent-session import uses (`AgentSessionScanner`): user and assistant
 * records that are not side chains, meta or compact summaries, keeping only their text blocks. A
 * tool result is a `user` record with no text block, so it is not a message. Each record carries
 * Claude Code's own `uuid`, which is what makes mirroring it twice a no-op.
 *
 * @module baton/liveTranscript
 */

export interface LiveTranscriptMessage {
  readonly uuid: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

/** Claude Code's project folder for a directory: every non-alphanumeric becomes `-`. */
export const claudeProjectSlug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, "-");

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
        ? [((block as { text: string }).text ?? "").trim()]
        : [],
    )
    .filter((text) => text.length > 0)
    .join("\n");
};

/** One transcript line, or null when it is not a message a person would read. */
export const parseLiveTranscriptLine = (line: string): LiveTranscriptMessage | null => {
  if (line.trim().length === 0) return null;
  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return null;
    record = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = record["type"];
  if (type !== "user" && type !== "assistant") return null;
  if (record["isSidechain"] === true || record["isMeta"] === true) return null;
  if (record["isCompactSummary"] === true) return null;
  const uuid = record["uuid"];
  if (typeof uuid !== "string" || uuid.length === 0) return null;
  const message = record["message"];
  const text = textOf(
    typeof message === "object" && message !== null
      ? (message as { content?: unknown }).content
      : undefined,
  );
  if (text.length === 0) return null;
  const timestamp = record["timestamp"];
  return {
    uuid,
    role: type,
    text,
    createdAt:
      typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp))
        ? new Date(timestamp).toISOString()
        : new Date(0).toISOString(),
  };
};

/**
 * Split a chunk read from the transcript into whole lines and the unfinished tail. Claude Code
 * appends one JSON record per line; a read can land mid-record, and that part waits for the next.
 */
export const splitTranscriptChunk = (
  chunk: string,
): { readonly lines: ReadonlyArray<string>; readonly rest: string } => {
  const end = chunk.lastIndexOf("\n");
  if (end < 0) return { lines: [], rest: chunk };
  return { lines: chunk.slice(0, end).split("\n"), rest: chunk.slice(end + 1) };
};

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Whether a transcript user message is the one a T3 composer already put in the thread. Baton's
 * agent types the composer text and may add `@path` lines for attachments, so the transcript
 * copy starts with what T3 recorded.
 */
export const isComposerEcho = (transcriptText: string, composerText: string): boolean => {
  const sent = normalize(composerText);
  return sent.length > 0 && normalize(transcriptText).startsWith(sent);
};
