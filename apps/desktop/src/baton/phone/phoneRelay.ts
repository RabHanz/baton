/**
 * The desktop's end of the phone relay: it takes what the phone asked from the server, runs it through the one assistant exactly
 * like a typed Ask, and sends the short reply and the card text back. It also mirrors the questions it asks him to the phone.
 * It never throws; a server that does not answer just means the desktop is away.
 */
import type { PhoneMirror } from "../screen/ScreenCompanion.ts";

export type PhoneCall = (op: string, args: Record<string, unknown>) => Promise<unknown>;

const POLL_MS = 1_500;

export const createPhoneRelay = (input: {
  readonly call: PhoneCall;
  /** The assistant, as a typed Ask. */
  readonly run: (text: string) => Promise<{ readonly spoken: string; readonly card: string }>;
  readonly wait?: (ms: number) => Promise<void>;
  readonly newId?: () => string;
}) => {
  const wait = input.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const newId = input.newId ?? (() => `d-${globalThis.crypto.randomUUID()}`);
  let busy = false;

  /** One look at the inbox. "away" means the server did not answer. */
  const tick = async (): Promise<"idle" | "answered" | "failed" | "away" | "busy"> => {
    if (busy) return "busy";
    busy = true;
    try {
      let item: { id?: unknown; text?: unknown } | null;
      try {
        item = (await input.call("take", {})) as { id?: unknown; text?: unknown } | null;
      } catch {
        return "away";
      }
      if (item === null || typeof item.id !== "string" || typeof item.text !== "string") return "idle";
      try {
        const reply = await input.run(item.text);
        await input.call("answer", { id: item.id, spoken: reply.spoken, card: reply.card });
        return "answered";
      } catch {
        await input.call("fail", { id: item.id, message: "Tessaya could not do that just now." }).catch(() => undefined);
        return "failed";
      }
    } finally {
      busy = false;
    }
  };

  /** Shows the question on the phone until it is answered there or closed here. */
  const mirror: PhoneMirror = (question) => {
    const id = newId();
    let open = true;
    const answer = new Promise<number>((resolve) => {
      void (async () => {
        try {
          await input.call("prompt", { id, ...question, buttons: [...question.buttons] });
        } catch {
          return;
        }
        while (open) {
          await wait(POLL_MS);
          if (!open) return;
          const got = await input.call("promptPoll", { id }).catch(() => null);
          if (typeof got === "number") return resolve(got);
        }
      })();
    });
    return {
      answer,
      close: () => {
        open = false;
        void input.call("promptClose", { id }).catch(() => undefined);
      },
    };
  };

  return { tick, mirror };
};
