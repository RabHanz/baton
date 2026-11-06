/**
 * The phone's durable inbox for the desktop assistant: what the phone page asked, kept until the desktop answers it or it
 * expires, and the desktop's own questions mirrored so the phone can answer them. The desktop is the only worker; the
 * server never runs an ask. Every ask is the user's own typed or spoken words, marked source "phone".
 */
import {
  ASK_LEASE_MS,
  ASK_TEXT_MAX,
  ASK_TTL_MS,
  CLIENT_ID,
  PROMPT_TTL_MS,
  QUEUE_MAX,
  askLine,
  isConnected,
  type AskStatus,
  type PhoneAsk,
  type PhonePrompt,
} from "@t3tools/baton-shared/phoneRelay";
import { BatonPhoneError, type BatonPhoneCallInput } from "@t3tools/baton-contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

interface AskRow {
  readonly id: string;
  readonly text: string;
  readonly source: string;
  readonly status: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly taken_at: number | null;
  readonly spoken: string | null;
  readonly card: string | null;
  readonly error: string | null;
}
interface PromptRow {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly buttons: string;
  readonly yes: number;
  readonly cancel: number;
  readonly needs: string | null;
  readonly status: string;
  readonly answer: number | null;
}

const fromAsk = (r: AskRow): PhoneAsk => ({
  id: r.id,
  text: r.text,
  source: "phone",
  status: r.status as AskStatus,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  spoken: r.spoken,
  card: r.card,
  error: r.error,
});

/** A question can carry this many answers; the cloud card needs one per assistant-and-account, then Deny and Decide later. */
export const MAX_BUTTONS = 8;
const ButtonsJson = Schema.fromJsonString(Schema.Array(Schema.String));
const encodeButtons = Schema.encodeSync(ButtonsJson);
const decodeButtons = Schema.decodeSync(ButtonsJson);

export type PostResult =
  | { readonly ok: true; readonly ask: PhoneAsk }
  | { readonly ok: false; readonly why: string };

export class BatonPhoneInbox extends Context.Service<
  BatonPhoneInbox,
  {
    /** The phone posts; a repeat of the same client id returns the first (a retry never asks twice). */
    readonly post: (input: {
      readonly id: string;
      readonly text: string;
    }) => Effect.Effect<PostResult>;
    readonly get: (id: string) => Effect.Effect<PhoneAsk | null>;
    readonly recent: (limit: number) => Effect.Effect<ReadonlyArray<PhoneAsk>>;
    /** The desktop takes the oldest waiting ask (null when none), and is counted as connected. */
    readonly take: Effect.Effect<PhoneAsk | null>;
    readonly answer: (id: string, spoken: string, card: string) => Effect.Effect<boolean>;
    readonly fail: (id: string, message: string) => Effect.Effect<boolean>;
    readonly connected: Effect.Effect<boolean>;
    /** The desktop mirrors a question it is asking him. */
    readonly mirror: (prompt: PhonePrompt) => Effect.Effect<void>;
    readonly pending: Effect.Effect<ReadonlyArray<PhonePrompt>>;
    /** The phone answers a mirrored question; false if it was already answered or gone. */
    readonly answerPrompt: (id: string, index: number) => Effect.Effect<boolean>;
    /** The desktop asks whether the phone answered: the button index, or null. */
    readonly promptAnswer: (id: string) => Effect.Effect<number | null>;
    readonly closePrompt: (id: string) => Effect.Effect<void>;
  }
>()("t3/baton/BatonPhoneInbox") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  let lastSeen: number | null = null;

  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* sql`
      UPDATE fabric_phone_asks SET status = 'expired'
      WHERE status IN ('queued', 'taken') AND expires_at <= ${now}
    `;
    yield* sql`
      UPDATE fabric_phone_asks SET status = 'queued', taken_at = NULL
      WHERE status = 'taken' AND taken_at <= ${now - ASK_LEASE_MS}
    `;
    yield* sql`UPDATE fabric_phone_prompts SET status = 'closed' WHERE status = 'pending' AND expires_at <= ${now}`;
    // Old answered rows are only history.
    yield* sql`DELETE FROM fabric_phone_asks WHERE status IN ('answered','failed','expired') AND created_at <= ${now - 3 * ASK_TTL_MS}`;
    yield* sql`DELETE FROM fabric_phone_prompts WHERE status IN ('answered','closed') AND expires_at <= ${now - PROMPT_TTL_MS}`;
  }).pipe(Effect.orDie);

  const read = (id: string) =>
    sql<AskRow>`SELECT * FROM fabric_phone_asks WHERE id = ${id}`.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : fromAsk(rows[0]))),
      Effect.orDie,
    );

  const post = Effect.fn("BatonPhoneInbox.post")(function* (input: {
    readonly id: string;
    readonly text: string;
  }) {
    const trimmed = input.text.trim();
    if (!CLIENT_ID.test(input.id))
      return { ok: false as const, why: "That request had no valid id." };
    if (trimmed === "") return { ok: false as const, why: "Say something." };
    if (trimmed.length > ASK_TEXT_MAX)
      return { ok: false as const, why: "That is too long. Keep it short." };
    yield* sweep;
    const again = yield* read(input.id);
    if (again !== null) return { ok: true as const, ask: again };
    const now = yield* Clock.currentTimeMillis;
    const waiting = yield* sql<{
      n: number;
    }>`SELECT COUNT(*) AS n FROM fabric_phone_asks WHERE status IN ('queued','taken')`.pipe(
      Effect.orDie,
    );
    if ((waiting[0]?.n ?? 0) >= QUEUE_MAX) {
      return { ok: false as const, why: "Too many asks are waiting. Let your computer catch up." };
    }
    yield* sql`
      INSERT INTO fabric_phone_asks (id, text, source, status, created_at, expires_at)
      VALUES (${input.id}, ${trimmed}, 'phone', 'queued', ${now}, ${now + ASK_TTL_MS})
    `.pipe(Effect.orDie);
    return { ok: true as const, ask: (yield* read(input.id))! };
  });

  const take = Effect.gen(function* () {
    yield* sweep;
    const now = yield* Clock.currentTimeMillis;
    lastSeen = now;
    const rows = yield* sql<AskRow>`
      SELECT * FROM fabric_phone_asks WHERE status = 'queued' ORDER BY created_at, id LIMIT 1
    `.pipe(Effect.orDie);
    const row = rows[0];
    if (row === undefined) return null;
    yield* sql`UPDATE fabric_phone_asks SET status = 'taken', taken_at = ${now} WHERE id = ${row.id}`.pipe(
      Effect.orDie,
    );
    return (yield* read(row.id))!;
  });

  const get = Effect.fn("BatonPhoneInbox.get")(function* (id: string) {
    yield* sweep;
    return yield* read(id);
  });

  const recent = Effect.fn("BatonPhoneInbox.recent")(function* (limit: number) {
    yield* sweep;
    const rows =
      yield* sql<AskRow>`SELECT * FROM fabric_phone_asks ORDER BY created_at DESC, id DESC LIMIT ${limit}`.pipe(
        Effect.orDie,
      );
    return rows.map(fromAsk);
  });

  const settle = Effect.fn("BatonPhoneInbox.settle")(function* (
    id: string,
    status: "answered" | "failed",
    spoken: string | null,
    card: string | null,
    error: string | null,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const current = yield* read(id);
    if (current === null || current.status !== "taken") return false;
    yield* sql`
      UPDATE fabric_phone_asks SET status = ${status}, answered_at = ${now}, spoken = ${spoken}, card = ${card}, error = ${error}
      WHERE id = ${id}
    `.pipe(Effect.orDie);
    return true;
  });

  const answer = (id: string, spoken: string, card: string) =>
    settle(id, "answered", spoken.slice(0, 4000), card.slice(0, 4000), null);
  const fail = (id: string, message: string) =>
    settle(id, "failed", null, null, message.slice(0, 500));

  const mirror = Effect.fn("BatonPhoneInbox.mirror")(function* (prompt: PhonePrompt) {
    const now = yield* Clock.currentTimeMillis;
    yield* sql`
      INSERT OR REPLACE INTO fabric_phone_prompts (id, title, detail, buttons, yes, cancel, needs, status, answer, created_at, expires_at)
      VALUES (${prompt.id}, ${prompt.title.slice(0, 200)}, ${prompt.detail.slice(0, 4000)}, ${encodeButtons(prompt.buttons.slice(0, MAX_BUTTONS))},
              ${prompt.yes}, ${prompt.cancel}, ${prompt.needs ?? null}, 'pending', NULL, ${now}, ${now + PROMPT_TTL_MS})
    `.pipe(Effect.orDie);
  });

  const pending = Effect.gen(function* () {
    yield* sweep;
    const rows =
      yield* sql<PromptRow>`SELECT * FROM fabric_phone_prompts WHERE status = 'pending' ORDER BY created_at`.pipe(
        Effect.orDie,
      );
    return rows.map((r): PhonePrompt => ({
      id: r.id,
      title: r.title,
      detail: r.detail,
      buttons: decodeButtons(r.buttons),
      yes: r.yes,
      cancel: r.cancel,
      ...(r.needs === "cloud-approve" ? { needs: "cloud-approve" as const } : {}),
    }));
  });

  const answerPrompt = Effect.fn("BatonPhoneInbox.answerPrompt")(function* (
    id: string,
    index: number,
  ) {
    yield* sweep;
    const rows =
      yield* sql<PromptRow>`SELECT * FROM fabric_phone_prompts WHERE id = ${id} AND status = 'pending'`.pipe(
        Effect.orDie,
      );
    const row = rows[0];
    const buttons = row === undefined ? 0 : decodeButtons(row.buttons).length;
    if (row === undefined || !Number.isInteger(index) || index < 0 || index >= buttons)
      return false;
    yield* sql`UPDATE fabric_phone_prompts SET status = 'answered', answer = ${index} WHERE id = ${id}`.pipe(
      Effect.orDie,
    );
    return true;
  });

  const promptAnswer = Effect.fn("BatonPhoneInbox.promptAnswer")(function* (id: string) {
    const rows = yield* sql<PromptRow>`SELECT * FROM fabric_phone_prompts WHERE id = ${id}`.pipe(
      Effect.orDie,
    );
    return rows[0]?.status === "answered" ? rows[0].answer : null;
  });

  const closePrompt = Effect.fn("BatonPhoneInbox.closePrompt")(function* (id: string) {
    yield* sql`UPDATE fabric_phone_prompts SET status = 'closed' WHERE id = ${id} AND status = 'pending'`.pipe(
      Effect.orDie,
    );
  });

  return BatonPhoneInbox.of({
    post,
    get,
    recent,
    take,
    answer,
    fail,
    connected: Effect.map(Clock.currentTimeMillis, (now) => isConnected(lastSeen, now)),
    mirror,
    pending,
    answerPrompt,
    promptAnswer,
    closePrompt,
  });
});

export const layer = Layer.effect(BatonPhoneInbox, make);

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

/** The desktop's calls (`baton.phone.call`): every argument is checked here, whatever the window sent. */
export const phoneCall = Effect.fn("BatonPhoneInbox.call")(function* (input: BatonPhoneCallInput) {
  const inbox = yield* BatonPhoneInbox;
  const a = input.args;
  const bad = () => new BatonPhoneError({ reason: "That phone call was not understood." });
  const id = str(a["id"], 80);
  switch (input.op) {
    // The web intent bar leaves words for the lead the same way the phone page does, and reads where they stand.
    case "ask": {
      const made = yield* inbox.post({
        id: id ?? "",
        text: typeof a["text"] === "string" ? a["text"] : "",
      });
      if (!made.ok) return { value: { ok: false, line: made.why } };
      return {
        value: {
          ok: true,
          status: made.ask.status,
          line: askLine(made.ask, yield* inbox.connected),
        },
      };
    }
    case "askGet": {
      if (id === null) return yield* bad();
      const ask = yield* inbox.get(id);
      return {
        value:
          ask === null ? null : { status: ask.status, line: askLine(ask, yield* inbox.connected) },
      };
    }
    case "take": {
      const ask = yield* inbox.take;
      return { value: ask === null ? null : { id: ask.id, text: ask.text, source: ask.source } };
    }
    case "answer":
    case "fail": {
      const text =
        input.op === "answer"
          ? (str(a["card"], 4000) ?? str(a["spoken"], 4000))
          : str(a["message"], 500);
      if (id === null || text === null) return yield* bad();
      const done =
        input.op === "answer"
          ? yield* inbox.answer(
              id,
              typeof a["spoken"] === "string" ? a["spoken"] : text,
              typeof a["card"] === "string" ? a["card"] : text,
            )
          : yield* inbox.fail(id, text);
      return { value: done };
    }
    case "prompt": {
      const title = str(a["title"], 200);
      const detail = str(a["detail"], 4000);
      const buttons = Array.isArray(a["buttons"])
        ? a["buttons"]
            .filter((b): b is string => typeof b === "string")
            .map((b) => b.slice(0, 60))
            .slice(0, MAX_BUTTONS)
        : [];
      const yes = Number(a["yes"]);
      const cancel = Number(a["cancel"]);
      if (
        id === null ||
        title === null ||
        detail === null ||
        buttons.length < 2 ||
        ![yes, cancel].every((n) => Number.isInteger(n) && n >= 0 && n < buttons.length)
      ) {
        return yield* bad();
      }
      yield* inbox.mirror({
        id,
        title,
        detail,
        buttons,
        yes,
        cancel,
        ...(a["needs"] === "cloud-approve" ? { needs: "cloud-approve" as const } : {}),
      });
      return { value: true };
    }
    case "promptPoll":
      return id === null ? yield* bad() : { value: yield* inbox.promptAnswer(id) };
    case "promptClose":
      if (id === null) return yield* bad();
      yield* inbox.closePrompt(id);
      return { value: true };
  }
});
