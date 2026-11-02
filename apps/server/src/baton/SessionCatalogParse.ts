/** Reading what Claude and the history index print: pure, so it is tested without a machine. */
import type { HistoryHit } from "./SessionCatalog.ts";

const TITLE_MAX = 90;

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text") {
        const t = (part as { text?: unknown }).text;
        if (typeof t === "string") return t;
      }
    }
  }
  return "";
};

/** The folder and a readable title from the first lines of a transcript: its summary, else the first thing he typed. */
export const readTranscriptHead = (head: string): { cwd: string | null; title: string } => {
  let cwd: string | null = null;
  let summary: string | null = null;
  let first: string | null = null;
  for (const line of head.split("\n")) {
    if (!line.startsWith("{")) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // the last line of the slice may be cut off
    }
    if (cwd === null && typeof o["cwd"] === "string") cwd = o["cwd"];
    if (summary === null && o["type"] === "summary" && typeof o["summary"] === "string") summary = o["summary"];
    if (first === null && o["type"] === "user" && o["isMeta"] !== true) {
      const msg = o["message"] as { content?: unknown } | undefined;
      const t = textOf(msg?.content).trim();
      // Wrappers Claude Code adds (reminders, command echoes, caveats) are not what he asked.
      if (t !== "" && !t.startsWith("<") && !t.startsWith("Caveat:")) first = t;
    }
  }
  const title = (summary ?? first ?? "Untitled conversation").replace(/\s+/g, " ").trim();
  return { cwd, title: title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title };
};

const HEADER = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)\s+(\S+)\s+(\S+)\s+([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i;
const NOISE = new Set(["tool_result", "tool_use", "thinking", "system", "meta"]);

/** The index prints `date role project session` then the hit; one row per session. */
export const parseHistoryHits = (text: string): ReadonlyArray<HistoryHit> => {
  const seen = new Map<string, HistoryHit>();
  for (const line of text.split("\n")) {
    const m = HEADER.exec(line);
    if (m === null || NOISE.has(m[2]!)) continue;
    if (!seen.has(m[4]!)) seen.set(m[4]!, { sessionId: m[4]!, project: m[3]!, at: `${m[1]}:00.000Z` });
  }
  return [...seen.values()];
};
