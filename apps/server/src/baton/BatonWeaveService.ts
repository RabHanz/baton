// @effect-diagnostics cryptoRandomUUID:off
/**
 * Weaving (D149): one session messages another by name. The server reads the target's pane first
 * and types only into an empty input; a busy or draft-holding target means the message waits in a
 * durable queue, in order, and goes when the pane can take it. Replies are read from the pane after
 * the message and kept as data. Every message is a row: who, when, text, delivered, replied.
 */
import {
  BatonWeaveError,
  type AdoptedSession,
  type AdoptedSessionCandidate,
  type BatonWeave,
} from "@t3tools/baton-contracts";
import {
  extractReply,
  nextStep,
  paneInputState,
  refuseWeave,
  resolveTarget,
  type WeaveRecord,
} from "@t3tools/baton-shared/weave";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { BatonWeaveBoxes, type WeaveBox } from "./BatonWeaveBoxes.ts";

interface Row {
  readonly id: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly to_pane: string;
  readonly text: string;
  readonly status: string;
  readonly reason: string | null;
  readonly job: string | null;
  readonly tries: number;
  readonly created_at: number;
  readonly delivered_at: number | null;
  readonly replied_at: number | null;
  readonly reply: string | null;
}

const fromRow = (r: Row): WeaveRecord => ({
  id: r.id,
  from: r.from_label,
  toLabel: r.to_label,
  toPane: r.to_pane,
  text: r.text,
  status: r.status as WeaveRecord["status"],
  reason: r.reason,
  job: r.job,
  tries: r.tries,
  createdAt: r.created_at,
  deliveredAt: r.delivered_at,
  repliedAt: r.replied_at,
  reply: r.reply,
});

/** Nothing waits on a reply longer than this; the message stays "delivered". */
const REPLY_WINDOW_MS = 6 * 3_600_000;
const SCREEN_LINES = 60;
const newId = (): string => globalThis.crypto.randomUUID().slice(0, 8);

export class BatonWeaveService extends Context.Service<
  BatonWeaveService,
  {
    readonly send: (input: {
      readonly to: string;
      readonly text: string;
      readonly from?: string;
      readonly job?: string;
    }) => Effect.Effect<BatonWeave, BatonWeaveError>;
    readonly list: (limit?: number) => Effect.Effect<ReadonlyArray<BatonWeave>>;
    readonly tick: Effect.Effect<{ delivered: number; replied: number }>;
  }
>()("t3/baton/BatonWeaveService") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const boxes = yield* BatonWeaveBoxes;
  const nowMs = Clock.currentTimeMillis;

  const get = (id: string) =>
    sql<Row>`SELECT * FROM fabric_weaves WHERE id = ${id}`.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : fromRow(rows[0]))),
      Effect.orDie,
    );

  const setState = (
    id: string,
    patch: {
      status: WeaveRecord["status"];
      reason: string | null;
      tries: number;
      deliveredAt?: number | null;
      repliedAt?: number | null;
      reply?: string | null;
    },
  ) =>
    sql`
      UPDATE fabric_weaves SET status = ${patch.status}, reason = ${patch.reason}, tries = ${patch.tries},
        delivered_at = COALESCE(${patch.deliveredAt ?? null}, delivered_at),
        replied_at = COALESCE(${patch.repliedAt ?? null}, replied_at),
        reply = COALESCE(${patch.reply ?? null}, reply)
      WHERE id = ${id}
    `.pipe(Effect.orDie);

  /** The pane key stored in a record: which machine, and the pane there. */
  const paneKey = (box: string, pane: string) => `${box}|${pane}`;
  const splitKey = (key: string): { box: string; pane: string } => {
    const at = key.indexOf("|");
    return at < 0 ? { box: "here", pane: key } : { box: key.slice(0, at), pane: key.slice(at + 1) };
  };
  const boxNamed = (name: string): WeaveBox | undefined => boxes.find((b) => b.name === name);

  /** Only the pane and label are read by the adapter; no stored session is involved. */
  const synth = (c: AdoptedSessionCandidate): AdoptedSession =>
    ({
      id: `weave:${c.location.pane}`,
      runtime: "herdr",
      workSessionId: null,
      label: c.label,
      location: c.location,
      agentKind: c.agentKind,
      state: "idle",
      capabilities: {
        readConversation: false,
        sendInput: true,
        approvals: false,
        diffs: false,
        stop: false,
        showTerminal: true,
      },
    }) as unknown as AdoptedSession;

  /** Looks at the target now and, if it can take the message, types it. */
  const attempt = (rec: WeaveRecord) =>
    Effect.gen(function* () {
      const now = yield* nowMs;
      const { box: boxName, pane } = splitKey(rec.toPane);
      const box = boxNamed(boxName);
      const found = box === undefined ? null : yield* box.adapter.discover;
      const cand = found?.candidates.find((c) => c.location.pane === pane);
      if (box === undefined || cand === undefined) {
        const step = nextStep(rec, { present: false, busy: false, input: "unknown" }, now);
        yield* setState(rec.id, {
          status: step.do === "lose" ? "lost" : "queued",
          reason: step.do === "send" ? null : step.why,
          tries: rec.tries + 1,
        });
        return step.do === "lose" ? ("lost" as const) : ("waiting" as const);
      }
      const busy = cand.runtimeState === "working" || cand.runtimeState === "blocked";
      const session = synth(cand);
      const out = box.queueOnly
        ? null
        : yield* box.adapter.readOutput({ session, lines: SCREEN_LINES });
      const input = box.queueOnly ? "empty" : out?.available ? paneInputState(out.output) : "unknown";
      const step = nextStep(rec, { present: true, busy, input }, now);
      if (step.do === "send") {
        const sent = yield* box.adapter.sendInput({ session, text: rec.text, submit: true });
        if (sent.delivered) {
          yield* setState(rec.id, {
            status: "delivered",
            reason: box.queueOnly ? sent.detail : null,
            tries: rec.tries + 1,
            deliveredAt: now,
          });
          return "delivered" as const;
        }
        yield* setState(rec.id, {
          status: "queued",
          reason: sent.detail || "the pane did not take it",
          tries: rec.tries + 1,
        });
        return "waiting" as const;
      }
      if (step.do === "lose") {
        yield* setState(rec.id, { status: "lost", reason: step.why, tries: rec.tries + 1 });
        return "lost" as const;
      }
      yield* setState(rec.id, { status: "queued", reason: step.why, tries: rec.tries + 1 });
      return "waiting" as const;
    }).pipe(
      Effect.catchCause(() =>
        setState(rec.id, {
          status: "queued",
          reason: "the pane could not be read",
          tries: rec.tries + 1,
        }).pipe(Effect.as("waiting" as const)),
      ),
    );

  const send = Effect.fn("BatonWeaveService.send")(function* (input: {
    readonly to: string;
    readonly text: string;
    readonly from?: string;
    readonly job?: string;
  }) {
    const refusal = refuseWeave(input.text);
    if (refusal !== null) return yield* new BatonWeaveError({ reason: refusal });
    const seen = yield* Effect.forEach(boxes, (box) =>
      Effect.map(box.adapter.discover, (found) => ({ box, found })),
    );
    if (seen.every((x) => !x.found.available)) {
      return yield* new BatonWeaveError({
        reason: seen[0]?.found.reason ?? "no sessions are reachable",
      });
    }
    const all = seen.flatMap(({ box, found }) =>
      found.candidates.map((c) => ({
        label: box.name === "here" ? c.label : `${box.name}:${c.label}`,
        pane: paneKey(box.name, c.location.pane),
        state: c.runtimeState,
        agentKind: c.agentKind,
      })),
    );
    const target = resolveTarget(input.to, all);
    if (!target.ok) return yield* new BatonWeaveError({ reason: target.why });
    const now = yield* nowMs;
    const id = newId();
    yield* sql`
      INSERT INTO fabric_weaves (id, from_label, to_label, to_pane, text, status, job, tries, created_at)
      VALUES (${id}, ${input.from ?? "Tessaya"}, ${target.target.label}, ${target.target.pane}, ${input.text.trim()},
              'queued', ${input.job ?? null}, 0, ${now})
    `.pipe(Effect.orDie);
    // Earlier messages to the same pane go first, so the order he sent them in is kept.
    yield* drainPane(target.target.pane);
    const sent = (yield* get(id))!;
    if (input.from !== undefined && sent.status === "delivered") {
      const line = `Sent to ${sent.toLabel}: "${sent.text.slice(0, 80)}"${sent.reason === null ? "" : ` (${sent.reason})`}`;
      yield* Effect.forEach(boxes, (b) => b.notify?.(input.from!, line) ?? Effect.void, {
        discard: true,
      });
    }
    return sent;
  });

  /** Oldest first; stops at the first message that cannot go yet. */
  const drainPane = Effect.fn("BatonWeaveService.drainPane")(function* (pane: string) {
    const rows = yield* sql<Row>`
        SELECT * FROM fabric_weaves WHERE status = 'queued' AND to_pane = ${pane} ORDER BY created_at, id
      `.pipe(Effect.orDie);
    let delivered = 0;
    for (const row of rows) {
      const r = yield* attempt(fromRow(row));
      if (r === "delivered") {
        delivered += 1;
        continue;
      }
      if (r === "lost") continue;
      break;
    }
    return delivered;
  });

  const tick = Effect.gen(function* () {
    const panes = yield* sql<{ to_pane: string }>`
      SELECT DISTINCT to_pane FROM fabric_weaves WHERE status = 'queued'
    `.pipe(Effect.orDie);
    let delivered = 0;
    for (const { to_pane } of panes) delivered += yield* drainPane(to_pane);

    const now = yield* nowMs;
    const waiting = yield* sql<Row>`
      SELECT * FROM fabric_weaves WHERE status = 'delivered' AND delivered_at > ${now - REPLY_WINDOW_MS}
    `.pipe(Effect.orDie);
    let replied = 0;
    for (const row of waiting) {
      const { box: boxName, pane } = splitKey(row.to_pane);
      const box = boxNamed(boxName);
      if (box === undefined || box.queueOnly) continue;
      const text = yield* Effect.gen(function* () {
        const found = yield* box.adapter.discover;
        const cand = found.candidates.find((c) => c.location.pane === pane);
        // Read only once it has stopped working, so a half-written answer is not taken as the reply.
        if (cand === undefined || cand.runtimeState === "working") return null;
        const out = yield* box.adapter.readOutput({ session: synth(cand), lines: 200 });
        return out.available ? extractReply(out.output, row.text) : null;
      }).pipe(Effect.catchCause(() => Effect.succeed(null)));
      if (text !== null) {
        yield* setState(row.id, {
          status: "replied",
          reason: null,
          tries: row.tries,
          repliedAt: now,
          reply: text,
        });
        replied += 1;
      }
    }
    return { delivered, replied };
  });

  const list = (limit = 50) =>
    sql<Row>`SELECT * FROM fabric_weaves ORDER BY created_at DESC, id LIMIT ${limit}`.pipe(
      Effect.map((rows) => rows.map(fromRow)),
      Effect.orDie,
    );

  return BatonWeaveService.of({ send, list, tick });
});

export const layer = Layer.effect(BatonWeaveService, make);
