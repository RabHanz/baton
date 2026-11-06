// @effect-diagnostics globalTimers:off cryptoRandomUUID:off
/**
 * The desktop's end of the phone relay: it takes what the phone asked from the server, runs it through the one assistant exactly
 * like a typed Ask, and sends the short reply and the card text back. It also mirrors the questions it asks him to the phone.
 * It never throws; a server that does not answer just means the desktop is away.
 */
import type { AskSource } from "@t3tools/baton-shared/phoneRelay";

import type { PhoneMirror } from "../screen/ScreenCompanion.ts";

export type PhoneCall = (op: string, args: Record<string, unknown>) => Promise<unknown>;

const POLL_MS = 1_500;

/**
 * How long to wait before looking at the inbox again: quick while things are happening, slower the longer nothing does. A phone ask
 * after a quiet hour waits at most the longest delay, still inside the server's 45 s "connected" window.
 */
export const nextPollMs = (quietTicks: number): number =>
  quietTicks < 12 ? 5_000 : quietTicks < 60 ? 15_000 : 30_000;

/** A relay call that has not answered by then is a failed one: the loop goes on and the main thread is never held. */
export const PHONE_CALL_TIMEOUT_MS = 20_000;

/**
 * The relay's call into the app: asks only while the app's window is up, never inspecting windows synchronously (an
 * 81 s main-thread freeze sat in that check), gives up after a timeout, and marks its start and end so a stall names it.
 * Whatever goes wrong, including a synchronous throw, comes back as a rejected promise.
 */
export const guardedPhoneCall =
  (input: {
    readonly windowUp: () => Promise<boolean>;
    readonly request: PhoneCall;
    readonly mark: (name: string, detail?: Record<string, unknown>) => void;
    readonly timeoutMs?: number;
  }): PhoneCall =>
  async (op, args) => {
    input.mark("phone-call:begin", { op });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!(await input.windowUp())) throw new Error("The app window is not open.");
      return await Promise.race([
        input.request(op, args),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("The app did not answer the phone relay in time.")),
            input.timeoutMs ?? PHONE_CALL_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      input.mark("phone-call:end");
    }
  };

export const createPhoneRelay = (input: {
  readonly call: PhoneCall;
  /** The assistant, as a typed Ask; "device" words are a token's, never his own. */
  readonly run: (
    text: string,
    source: AskSource,
  ) => Promise<{ readonly spoken: string; readonly card: string }>;
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
      let item: { id?: unknown; text?: unknown; source?: unknown } | null;
      try {
        item = (await input.call("take", {})) as typeof item;
      } catch {
        return "away";
      }
      if (item === null || typeof item.id !== "string" || typeof item.text !== "string")
        return "idle";
      try {
        // Only the server's "phone" is his; anything else, or an older server's silence, is a device's.
        const reply = await input.run(item.text, item.source === "phone" ? "phone" : "device");
        await input.call("answer", { id: item.id, spoken: reply.spoken, card: reply.card });
        return "answered";
      } catch {
        await input
          .call("fail", { id: item.id, message: "Tessaya could not do that just now." })
          .catch(() => undefined);
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
