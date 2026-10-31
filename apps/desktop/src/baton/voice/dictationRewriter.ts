// @effect-diagnostics globalTimers:off globalDate:off nodeBuiltinImport:off
/**
 * The optional second pass: his own `claude` through the companion's session, so it bills his plan
 * and has no tools (D84). It can never hold dictation up: past `HARD_LIMIT_MS` the local text goes
 * in, the session is dropped, and the next dictation starts another.
 */
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import {
  cleanDictation,
  rewriteMessage,
  rewriteSystemPrompt,
  type CleanedText,
  type CleanupLevel,
  type DictationMode,
  type DictionaryEntry,
} from "@t3tools/baton-shared/dictationCleanup";

import { startVisionSession, type VisionSession } from "../screen/claudeVision.ts";

export const HARD_LIMIT_MS = 3_000;
const IDLE_MS = 10 * 60_000;
/** Each dictation stays in the session's context, so it starts over before that matters. */
const TURNS_PER_SESSION = 20;

export interface Rewriter {
  /** Called when recording starts, so the session is up by the time he stops. */
  readonly warm: () => void;
  readonly clean: (input: {
    readonly raw: string;
    readonly mode: DictationMode;
    readonly level: CleanupLevel;
  }) => Promise<CleanedText & { readonly ms: number }>;
  readonly dispose: () => void;
}

export const makeRewriter = (input: {
  readonly claudeBinary: string;
  readonly model: string;
  readonly workDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: string;
  readonly dictionary: () => ReadonlyArray<DictionaryEntry>;
  readonly limitMs?: number;
  readonly start?: typeof startVisionSession;
  readonly always?: boolean;
}): Rewriter => {
  const limitMs = input.limitMs ?? HARD_LIMIT_MS;
  let session: VisionSession | null = null;
  let turns = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const drop = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    session?.dispose();
    session = null;
    turns = 0;
  };
  const get = (): VisionSession => {
    if (idle !== null) clearTimeout(idle);
    idle = setTimeout(drop, IDLE_MS);
    session ??= (input.start ?? startVisionSession)({
      claudeBinary: input.claudeBinary,
      model: input.model,
      systemPrompt: rewriteSystemPrompt(input.dictionary()),
      workDir: input.workDir,
      env: input.env,
      platform: input.platform,
      timeoutMs: limitMs * 3,
    });
    return session;
  };

  const ask = async (text: string, mode: DictationMode): Promise<string> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        get().ask([{ type: "text", text: rewriteMessage(text, mode) }]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timed out")), limitMs);
        }),
      ]);
      turns += 1;
      return answer.trim();
    } catch (error) {
      // A late answer would be read as the next dictation's.
      drop();
      throw error;
    } finally {
      clearTimeout(timer);
      if (turns >= TURNS_PER_SESSION) drop();
    }
  };

  return {
    warm: () => {
      try {
        get();
      } catch {
        drop();
      }
    },
    clean: async ({ raw, mode, level }) => {
      const started = Date.now();
      const cleaned = await cleanDictation({
        raw,
        mode,
        level,
        dictionary: input.dictionary(),
        ask,
        ...(input.always === undefined ? {} : { always: input.always }),
      });
      return { ...cleaned, ms: Date.now() - started };
    },
    dispose: drop,
  };
};

const fileName = "dictionary.json";

const isEntry = (value: unknown): value is DictionaryEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as DictionaryEntry).phrase === "string";

/** `<state dir>/voice/dictionary.json`, a list he can edit; a bad file is no dictionary, not an error. */
export const readDictionary = async (
  stateDir: string,
): Promise<ReadonlyArray<DictionaryEntry> | null> => {
  try {
    const parsed: unknown = JSON.parse(
      await NodeFS.readFile(NodePath.join(stateDir, "voice", fileName), "utf8"),
    );
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return null;
  }
};

/** Wispr's table, read-only, once: what he taught it should not have to be taught twice. */
export const importWisprDictionary = async (input: {
  readonly stateDir: string;
  readonly appData: string | undefined;
}): Promise<ReadonlyArray<DictionaryEntry>> => {
  if (input.appData === undefined) return [];
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(NodePath.join(input.appData, "Wispr Flow", "flow.sqlite"), {
      readOnly: true,
    });
    const rows = db
      .prepare("select phrase, replacement from Dictionary where isDeleted = 0")
      .all() as ReadonlyArray<{ phrase: string | null; replacement: string | null }>;
    db.close();
    const entries = rows.flatMap((row): ReadonlyArray<DictionaryEntry> =>
      row.phrase === null || row.phrase.length === 0
        ? []
        : [{ phrase: row.phrase, replacement: row.replacement?.length ? row.replacement : null }],
    );
    await NodeFS.mkdir(NodePath.join(input.stateDir, "voice"), { recursive: true });
    await NodeFS.writeFile(
      NodePath.join(input.stateDir, "voice", fileName),
      JSON.stringify(entries, null, 2),
    );
    return entries;
  } catch {
    return [];
  }
};
