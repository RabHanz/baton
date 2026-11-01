import { settleOneShot } from "@t3tools/baton-shared/dictationOneShot";

/**
 * Spoken dictation all at once, however long: chunks are kept (and saved after each one, so a
 * crash or a failed paste loses nothing), tidied as one, fitted to the caret and inserted when
 * speech ends. A tidy-up that fails or times out inserts what was heard.
 */
export interface OneShotIo {
  readonly save: (chunks: ReadonlyArray<string>) => void;
  readonly clean: (
    raw: string,
  ) => Promise<{ readonly text: string; readonly stage: string } | null>;
  readonly fit: (text: string) => Promise<string>;
  readonly paste: (text: string) => Promise<boolean>;
}

export interface OneShotResult {
  readonly status: "empty" | "pasted" | "kept";
  /** What went (or would go) into the field. */
  readonly text: string;
  /** The tidy-up failed, so this is what was heard. */
  readonly failed: boolean;
}

export const createOneShot = (io: OneShotIo, restored: ReadonlyArray<string> = []) => {
  let chunks: Array<string> = [...restored];
  return {
    push: (text: string) => {
      chunks.push(text);
      io.save(chunks);
    },
    pending: (): ReadonlyArray<string> => chunks,
    flush: async (): Promise<OneShotResult> => {
      const raw = chunks.join(" ").trim();
      if (raw.length === 0) {
        chunks = [];
        io.save(chunks);
        return { status: "empty", text: "", failed: false };
      }
      const cleaned = await io.clean(raw).catch(() => null);
      const { text, failed } = settleOneShot(raw, cleaned);
      const fitted = await io.fit(text).catch(() => text);
      const pasted = await io.paste(fitted).catch(() => false);
      // The chunks stay on disk until the paste has landed.
      if (pasted) {
        chunks = [];
        io.save(chunks);
      }
      return { status: pasted ? "pasted" : "kept", text: fitted, failed };
    },
  };
};
