/**
 * Edits the selection in the focused app (Transforms now, Command mode next): copy it, ask the
 * model, put the result in its place, and remember how to take it back. The ports are the platform:
 * a clipboard copy of the selection, a paste over it, and a key press.
 */
import {
  checkTransformOutput,
  refuseTransformInput,
  transformMessage,
  transformSystemPrompt,
  undoable,
  type Transform,
  type UndoSlot,
} from "@t3tools/baton-shared/transforms";

export interface EditPorts {
  /** The selected text, or null when nothing is selected. */
  readonly copySelection: () => Promise<string | null>;
  /** Pastes over the selection. */
  readonly replaceSelection: (text: string) => Promise<void>;
  readonly press: (keys: ReadonlyArray<string>) => Promise<void>;
  readonly setClipboard: (text: string) => void;
  readonly ask: (system: string, user: string) => Promise<string>;
  readonly now: () => number;
}

export const createTextEdit = (ports: EditPorts) => {
  let slot: UndoSlot | null = null;

  /** Rewrites `selected` with the system prompt; the reply if it can stand in for the text. */
  const rewrite = async (
    selected: string,
    system: string,
    user: string,
  ): Promise<{ ok: true; text: string } | { ok: false; why: string }> => {
    let reply: string;
    try {
      reply = await ports.ask(system, user);
    } catch {
      return { ok: false, why: "The rewrite did not come back, so nothing changed." };
    }
    const checked = checkTransformOutput(selected, reply);
    return checked.ok
      ? { ok: true, text: checked.text }
      : { ok: false, why: `Nothing changed: ${checked.why}.` };
  };

  const apply = async (selected: string, text: string, done: string): Promise<string> => {
    await ports.replaceSelection(text);
    slot = { original: selected, applied: text, at: ports.now() };
    return `${done} Say "undo that" to put it back.`;
  };

  return {
    transform: async (t: Transform): Promise<string> => {
      const selected = await ports.copySelection();
      if (selected === null) return "Nothing is selected.";
      const refused = refuseTransformInput(selected);
      if (refused !== null) return refused;
      const out = await rewrite(selected, transformSystemPrompt(t), transformMessage(selected));
      return out.ok ? apply(selected, out.text, `${t.name} applied.`) : out.why;
    },
    /** For callers that already hold the text (the auto-apply after dictation). */
    transformText: async (t: Transform, text: string): Promise<string | null> => {
      if (refuseTransformInput(text) !== null) return null;
      const out = await rewrite(text, transformSystemPrompt(t), transformMessage(text));
      return out.ok ? out.text : null;
    },
    /** The app's own undo takes the paste back; the original also goes on the clipboard in case it did not. */
    undo: async (): Promise<string> => {
      const s = undoable(slot, ports.now());
      if (s === null) return "There is nothing to undo.";
      await ports.press(["ctrl", "z"]);
      ports.setClipboard(s.original);
      slot = null;
      return "Undone with the app's own undo. The original text is also on the clipboard in case that app did not take it.";
    },
    lastEdit: (): UndoSlot | null => slot,
    /** Used by command mode to share the undo slot. */
    remember: (original: string, applied: string): void => {
      slot = { original, applied, at: ports.now() };
    },
    ports,
  };
};
export type TextEdit = ReturnType<typeof createTextEdit>;
