// @effect-diagnostics tryCatchInEffectGen:off preferSchemaOverJson:off cryptoRandomUUIDInEffect:off flatMapConditionalToFilterOrFail:off nodeBuiltinImport:off
/**
 * Memory (D150, docs/baton/MEMORY.md): short items about him and his work, searchable, with a
 * single door that refuses what must never be kept. The desktop tools, the windows, a phone and
 * the learning loop all call these methods; the rules themselves are pure and live in
 * `@t3tools/baton-shared/memory`.
 */
import { BatonMemoryRefusedError } from "@t3tools/baton-contracts";
import {
  EPISODE_TTL_DAYS,
  SAME_ITEM_OVERLAP,
  applyDecision,
  DEFAULT_RECALL_TOKENS,
  effectiveConfidence,
  exportMarkdown,
  memoryBlock,
  refuseToStore,
  reinforced,
  shouldDelete,
  similarity,
  startingConfidence,
  tokens,
  winner,
  type MemoryChange,
  type MemoryHit,
  type MemoryDraft,
  type MemoryItem,
  type MemoryKind,
  type MemoryQuery,
} from "@t3tools/baton-shared/memory";
import { DEFAULT_OS_PACK, mayRecall } from "@t3tools/baton-shared/osPack";
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { readPack } from "./OperatingSystemPack.ts";

interface ItemRow {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly source: string;
  readonly source_ref: string | null;
  readonly scope: string;
  readonly scope_ref: string | null;
  readonly confidence: number;
  readonly pinned: number;
  readonly proposed: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_used_at: string | null;
  readonly expires_at: string | null;
  readonly superseded_by: string | null;
  readonly origin: string;
}

const fromRow = (row: ItemRow): MemoryItem => ({
  id: row.id,
  kind: row.kind as MemoryItem["kind"],
  text: row.text,
  source: row.source as MemoryItem["source"],
  sourceRef: row.source_ref,
  scope: row.scope as MemoryItem["scope"],
  scopeRef: row.scope_ref,
  confidence: row.confidence,
  pinned: row.pinned === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastUsedAt: row.last_used_at,
  expiresAt: row.expires_at,
  supersededBy: row.superseded_by,
  proposed: row.proposed === 1,
});

const refuse = (reason: string) => new BatonMemoryRefusedError({ reason });
const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 50;
const CANDIDATES = 200;
/** A sentence's recall leaves out hits weaker than this: one shared word in a long sentence. */
const RECALL_FLOOR = 0.25;

/** The loaded private pack files, so their text is never copied into memory (D148). Default: none. */
export const MemoryPrivateTexts = Context.Reference<() => ReadonlyArray<string>>(
  "t3/baton/BatonMemoryService/MemoryPrivateTexts",
  { defaultValue: () => () => [] },
);

export interface MemoryRecall {
  readonly block: string;
  readonly ids: ReadonlyArray<string>;
}

/**
 * Who is reading memory, set from the session by the transport (Baton's RPC middleware, the desk route): "desktop" is the
 * desktop app's own session, which may name a persona and ask for his own view (`admin`); "client" is any other token,
 * which sees nothing walled and whose `agent` is ignored. "server" is this server's own upkeep. Unset means "client".
 */
export const MemoryViewer = Context.Reference<"server" | "desktop" | "client">(
  "t3/baton/BatonMemoryService/MemoryViewer",
  { defaultValue: () => "client" },
);

export class BatonMemoryService extends Context.Service<
  BatonMemoryService,
  {
    /** This server's id in a sync; stable once made. */
    readonly origin: string;
    readonly list: (query?: MemoryQuery) => Effect.Effect<ReadonlyArray<MemoryItem>>;
    readonly search: (query: MemoryQuery) => Effect.Effect<ReadonlyArray<MemoryHit>>;
    /** Stores, reinforces a duplicate, or holds a tainted proposal; refuses what must not be kept. */
    readonly add: (draft: MemoryDraft) => Effect.Effect<MemoryItem, BatonMemoryRefusedError>;
    /** His edit: the item becomes his own words. */
    readonly edit: (
      id: string,
      patch: { readonly text?: string | undefined; readonly kind?: MemoryKind | undefined },
    ) => Effect.Effect<MemoryItem, BatonMemoryRefusedError>;
    /** The weekly pass's rewrite: new wording, but the source and confidence stay as they were. */
    readonly rewrite: (
      id: string,
      text: string,
    ) => Effect.Effect<MemoryItem, BatonMemoryRefusedError>;
    readonly pin: (
      id: string,
      pinned: boolean,
    ) => Effect.Effect<MemoryItem, BatonMemoryRefusedError>;
    /** Deletes the item and leaves a tombstone so a sync cannot bring it back. */
    readonly forget: (id: string) => Effect.Effect<boolean>;
    /** He said yes to a held proposal. */
    readonly accept: (id: string) => Effect.Effect<MemoryItem, BatonMemoryRefusedError>;
    /** The memory block for a prompt; with `turnRef` it records which items the turn used. */
    readonly recall: (context: {
      readonly text?: string | undefined;
      readonly scopeRef?: string | null | undefined;
      readonly budgetTokens?: number | undefined;
      readonly turnRef?: string | undefined;
      readonly agent?: string | undefined;
    }) => Effect.Effect<MemoryRecall>;
    readonly markUsed: (turnRef: string, ids: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly used: (turnRef?: string) => Effect.Effect<ReadonlyArray<MemoryItem>>;
    readonly exportMarkdown: Effect.Effect<string>;
    /** Deletes what expired or faded; returns how many. */
    readonly sweep: Effect.Effect<number>;
    /** This server's id and, for each peer, the newest change of theirs it has applied. */
    readonly syncHello: Effect.Effect<{
      readonly origin: string;
      readonly cursors: Readonly<Record<string, string>>;
    }>;
    /** Everything written here at or after `since` (null: all), except held proposals. */
    readonly changesSince: (since: string | null) => Effect.Effect<{
      readonly origin: string;
      readonly changes: ReadonlyArray<MemoryChange>;
      readonly upTo: string;
    }>;
    /** A peer's changes: last writer wins, a tombstone beats an older item. Returns how many took effect. */
    readonly applyChanges: (
      from: string,
      changes: ReadonlyArray<MemoryChange>,
      upTo: string,
    ) => Effect.Effect<number>;
    /** A switch kept with the memory (e.g. the scheduled learnings pull). */
    readonly flag: (key: string) => Effect.Effect<boolean>;
    readonly setFlag: (key: string, on: boolean) => Effect.Effect<void>;
    /** Notes what he talked about today (a few words), for the day's episode. */
    readonly noteTalk: (day: string, text: string) => Effect.Effect<void>;
    readonly talks: (day: string) => Effect.Effect<ReadonlyArray<string>>;
    /** Remembers `value` under `key`; true when it differs from what was there, so work is done once. */
    readonly noteOnce: (key: string, value: string) => Effect.Effect<boolean>;
  }
>()("t3/baton/BatonMemoryService") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const privateTexts = yield* MemoryPrivateTexts;
  const nowMs = Clock.currentTimeMillis;
  const nowIso = Effect.map(nowMs, (ms) => DateTime.formatIso(DateTime.makeUnsafe(ms)));

  const origin = yield* Effect.gen(function* () {
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM fabric_memory_meta WHERE key = 'origin'`;
    if (rows[0] !== undefined) return rows[0].value;
    const made = globalThis.crypto.randomUUID();
    yield* sql`INSERT OR IGNORE INTO fabric_memory_meta (key, value) VALUES ('origin', ${made})`;
    const again = yield* sql<{
      value: string;
    }>`SELECT value FROM fabric_memory_meta WHERE key = 'origin'`;
    return again[0]?.value ?? made;
  }).pipe(Effect.orDie);

  const read = (id: string) =>
    sql<ItemRow>`SELECT * FROM fabric_memory_items WHERE id = ${id}`.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : fromRow(rows[0]))),
      Effect.orDie,
    );

  const requireItem = (id: string) =>
    Effect.flatMap(read(id), (item) =>
      item === null ? Effect.fail(refuse("there is no such memory")) : Effect.succeed(item),
    );

  const matches = (item: MemoryItem, query: MemoryQuery): boolean =>
    (query.includeSuperseded === true || item.supersededBy === null) &&
    (query.includeProposed === true || !item.proposed) &&
    (query.kinds === undefined || query.kinds.length === 0 || query.kinds.includes(item.kind)) &&
    (query.scope === undefined || item.scope === query.scope);

  const listAll = Effect.fn("BatonMemoryService.listAll")(function* (query: MemoryQuery = {}) {
    const rows = yield* sql<ItemRow>`
      SELECT * FROM fabric_memory_items ORDER BY pinned DESC, updated_at DESC
    `.pipe(Effect.orDie);
    return rows
      .map(fromRow)
      .filter((item) => matches(item, query))
      .slice(0, query.limit ?? 500);
  });

  /** Decision 6: a walled project's items reach only its team; the wall is a label, not a second store. */
  const walls = Effect.fn("BatonMemoryService.walls")(function* (agent: string | undefined) {
    const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    const pack = Option.isNone(config)
      ? DEFAULT_OS_PACK
      : readPack(NodePath.dirname(config.value.dbPath));
    return (item: MemoryItem) =>
      item.scope !== "project" || item.scopeRef === null || mayRecall(pack, agent, item.scopeRef);
  });

  /** What this reader may see: walled unless it is upkeep or his own view on the desktop; a persona only from the desktop. */
  const viewFor = Effect.fn("BatonMemoryService.viewFor")(function* (
    agent: string | undefined,
    admin: boolean | undefined,
  ) {
    const viewer = yield* MemoryViewer;
    if (viewer === "server" || (viewer === "desktop" && admin === true)) return () => true;
    return yield* walls(viewer === "desktop" ? agent : undefined);
  });

  const list = Effect.fn("BatonMemoryService.list")(function* (query: MemoryQuery = {}) {
    const seen = yield* viewFor(query.agent, query.admin);
    return (yield* listAll({ ...query, limit: 100_000 })).filter(seen).slice(0, query.limit ?? 500);
  });

  const search = Effect.fn("BatonMemoryService.search")(function* (query: MemoryQuery) {
    const words = tokens(query.text ?? "");
    const limit = query.limit ?? DEFAULT_LIMIT;
    // A caller that forgets to name its persona sees nothing walled.
    const seen = yield* viewFor(query.agent, query.admin);
    if (words.length === 0) {
      const items = (yield* listAll(query)).filter(seen);
      return items.slice(0, limit).map((item) => ({ item, score: item.pinned ? 1 : 0.5 }));
    }
    const expression = words.map((w) => `"${w}"*`).join(" OR ");
    const rows = yield* sql<ItemRow>`
      SELECT i.* FROM fabric_memory_fts
      JOIN fabric_memory_items i ON i.rowid = fabric_memory_fts.rowid
      WHERE fabric_memory_fts MATCH ${expression}
      ORDER BY bm25(fabric_memory_fts)
      LIMIT ${CANDIDATES}
    `.pipe(Effect.orDie);
    const now = yield* nowMs;
    const wanted = new Set(words);
    return rows
      .map(fromRow)
      .filter((item) => matches(item, query) && seen(item))
      .map((item) => {
        const have = new Set(tokens(item.text));
        let both = 0;
        for (const w of wanted) if (have.has(w) || [...have].some((h) => h.startsWith(w))) both++;
        const score =
          (both / wanted.size) * (0.5 + 0.5 * effectiveConfidence(item, now)) +
          (item.pinned ? 0.1 : 0) +
          (query.scopeRef !== undefined &&
          query.scopeRef !== null &&
          item.scopeRef === query.scopeRef
            ? 0.2
            : 0);
        return { item, score };
      })
      .toSorted((a, b) => b.score - a.score)
      .slice(0, limit);
  });

  const add = Effect.fn("BatonMemoryService.add")(function* (draft: MemoryDraft) {
    const reason = refuseToStore(draft.text, privateTexts());
    if (reason !== null) return yield* refuse(reason);
    const text = draft.text.trim().replace(/\s+/g, " ");
    const scope = draft.scope ?? "global";
    const scopeRef = scope === "global" ? null : (draft.scopeRef ?? null);
    const at = yield* nowIso;
    const ms = yield* nowMs;

    const peers = yield* sql<ItemRow>`
      SELECT * FROM fabric_memory_items
      WHERE superseded_by IS NULL AND scope = ${scope} AND scope_ref IS ${scopeRef}
      ORDER BY updated_at DESC LIMIT 500
    `.pipe(Effect.orDie);
    const same = peers.map(fromRow).find((p) => similarity(p.text, text) >= SAME_ITEM_OVERLAP);
    if (same !== undefined) {
      const hers = draft.source === "user";
      yield* sql`
        UPDATE fabric_memory_items SET
          confidence = ${hers ? 1 : reinforced(same)},
          source = ${hers ? "user" : same.source},
          pinned = ${draft.pinned === true || same.pinned ? 1 : 0},
          updated_at = ${at}, received_at = ${at}, origin = ${origin}
        WHERE id = ${same.id}
      `.pipe(Effect.orDie);
      return yield* requireItem(same.id);
    }

    const id = globalThis.crypto.randomUUID();
    const expiresAt =
      draft.expiresAt ??
      (draft.kind === "episode"
        ? DateTime.formatIso(DateTime.makeUnsafe(ms + EPISODE_TTL_DAYS * DAY_MS))
        : null);
    const proposed = draft.tainted === true && draft.source !== "user";
    yield* sql`
      INSERT INTO fabric_memory_items (
        id, kind, text, source, source_ref, scope, scope_ref, confidence, pinned, proposed,
        created_at, updated_at, last_used_at, expires_at, superseded_by, origin, received_at
      ) VALUES (
        ${id}, ${draft.kind}, ${text}, ${draft.source}, ${draft.sourceRef ?? null}, ${scope},
        ${scopeRef}, ${startingConfidence(draft)}, ${draft.pinned === true ? 1 : 0},
        ${proposed ? 1 : 0}, ${at}, ${at}, NULL, ${expiresAt}, NULL, ${origin}, ${at}
      )
    `.pipe(Effect.orDie);
    const created = yield* requireItem(id);

    if (draft.supersedes !== undefined && draft.supersedes !== id) {
      const old = yield* read(draft.supersedes);
      if (old !== null) {
        // His words beat a model's; otherwise the newer one, then the more certain (MEMORY.md).
        // The new one first: on a tie in time it is still the later statement.
        const loser = winner(created, old).id === old.id ? created : old;
        const keeper = loser.id === old.id ? created : old;
        yield* sql`
          UPDATE fabric_memory_items SET superseded_by = ${keeper.id}, updated_at = ${at}, received_at = ${at}, origin = ${origin}
          WHERE id = ${loser.id}
        `.pipe(Effect.orDie);
      }
    }
    return yield* requireItem(id);
  });

  const touch = (id: string, at: string) =>
    sql`UPDATE fabric_memory_items SET updated_at = ${at}, received_at = ${at}, origin = ${origin} WHERE id = ${id}`.pipe(
      Effect.orDie,
    );

  const edit = Effect.fn("BatonMemoryService.edit")(function* (
    id: string,
    patch: { readonly text?: string | undefined; readonly kind?: MemoryKind | undefined },
  ) {
    const current = yield* requireItem(id);
    const at = yield* nowIso;
    const text = patch.text === undefined ? current.text : patch.text.trim().replace(/\s+/g, " ");
    const reason = refuseToStore(text, privateTexts());
    if (reason !== null) return yield* refuse(reason);
    yield* sql`
      UPDATE fabric_memory_items SET
        text = ${text}, kind = ${patch.kind ?? current.kind}, source = 'user', confidence = 1,
        proposed = 0, updated_at = ${at}, received_at = ${at}, origin = ${origin}
      WHERE id = ${id}
    `.pipe(Effect.orDie);
    return yield* requireItem(id);
  });

  const rewrite = Effect.fn("BatonMemoryService.rewrite")(function* (id: string, wording: string) {
    yield* requireItem(id);
    const text = wording.trim().replace(/\s+/g, " ");
    const reason = refuseToStore(text, privateTexts());
    if (reason !== null) return yield* refuse(reason);
    const at = yield* nowIso;
    yield* sql`
      UPDATE fabric_memory_items SET text = ${text}, updated_at = ${at}, received_at = ${at}, origin = ${origin}
      WHERE id = ${id}
    `.pipe(Effect.orDie);
    return yield* requireItem(id);
  });

  const pin = Effect.fn("BatonMemoryService.pin")(function* (id: string, pinned: boolean) {
    yield* requireItem(id);
    yield* sql`UPDATE fabric_memory_items SET pinned = ${pinned ? 1 : 0} WHERE id = ${id}`.pipe(
      Effect.orDie,
    );
    yield* touch(id, yield* nowIso);
    return yield* requireItem(id);
  });

  const remove = (id: string, at: string) =>
    sql`DELETE FROM fabric_memory_items WHERE id = ${id}`.pipe(
      Effect.andThen(
        sql`INSERT OR REPLACE INTO fabric_memory_tombstones (id, deleted_at, origin, received_at) VALUES (${id}, ${at}, ${origin}, ${at})`,
      ),
      Effect.andThen(sql`DELETE FROM fabric_memory_uses WHERE item_id = ${id}`),
      Effect.orDie,
    );

  const forget = Effect.fn("BatonMemoryService.forget")(function* (id: string) {
    if ((yield* read(id)) === null) return false;
    yield* remove(id, yield* nowIso);
    return true;
  });

  const accept = Effect.fn("BatonMemoryService.accept")(function* (id: string) {
    yield* requireItem(id);
    yield* sql`UPDATE fabric_memory_items SET proposed = 0 WHERE id = ${id}`.pipe(Effect.orDie);
    yield* touch(id, yield* nowIso);
    return yield* requireItem(id);
  });

  const markUsed = Effect.fn("BatonMemoryService.markUsed")(function* (
    turnRef: string,
    ids: ReadonlyArray<string>,
  ) {
    const at = yield* nowIso;
    for (const id of ids) {
      yield* sql`UPDATE fabric_memory_items SET last_used_at = ${at} WHERE id = ${id}`.pipe(
        Effect.orDie,
      );
      yield* sql`INSERT OR IGNORE INTO fabric_memory_uses (turn_ref, item_id, at) VALUES (${turnRef}, ${id}, ${at})`.pipe(
        Effect.orDie,
      );
    }
  });

  const recall = Effect.fn("BatonMemoryService.recall")(function* (context: {
    readonly text?: string | undefined;
    readonly scopeRef?: string | null | undefined;
    readonly budgetTokens?: number | undefined;
    readonly turnRef?: string | undefined;
    readonly agent?: string | undefined;
  }) {
    const now = yield* nowMs;
    const seen = yield* viewFor(context.agent, false);
    const words = context.text === undefined ? [] : tokens(context.text);
    // A sentence gets what matches it: the standing set is already in the session's system prompt.
    const hits =
      words.length > 0
        ? (yield* search({
            text: context.text!,
            ...(context.scopeRef === undefined ? {} : { scopeRef: context.scopeRef }),
            ...(context.agent === undefined ? {} : { agent: context.agent }),
            limit: 40,
          })).filter((hit) => hit.score >= RECALL_FLOOR)
        : (yield* listAll({ kinds: ["note", "preference", "correction", "decision"] }))
            .filter((item) => item.pinned || item.source === "user" || item.confidence >= 0.6)
            .slice(0, 40)
            .map((item) => ({ item, score: effectiveConfidence(item, now) }));
    const ranked = hits
      // Another project's items stay out of a turn that names its project.
      .filter(
        ({ item }) =>
          typeof context.scopeRef !== "string" ||
          item.scope !== "project" ||
          item.scopeRef === context.scopeRef,
      )
      .filter(({ item }) => seen(item))
      .filter((hit) => effectiveConfidence(hit.item, now) >= 0.1 || hit.item.pinned)
      .toSorted((a, b) => b.score - a.score)
      .map((hit) => hit.item);
    const out = memoryBlock(ranked, context.budgetTokens ?? DEFAULT_RECALL_TOKENS);
    if (context.turnRef !== undefined && out.ids.length > 0) {
      yield* markUsed(context.turnRef, out.ids);
    }
    return out;
  });

  const used = Effect.fn("BatonMemoryService.used")(function* (turnRef?: string) {
    const rows = yield* sql<ItemRow>`
      SELECT i.* FROM fabric_memory_uses u
      JOIN fabric_memory_items i ON i.id = u.item_id
      WHERE u.turn_ref = COALESCE(
        ${turnRef ?? null},
        (SELECT turn_ref FROM fabric_memory_uses ORDER BY at DESC, rowid DESC LIMIT 1)
      )
      ORDER BY i.pinned DESC, i.updated_at DESC
    `.pipe(Effect.orDie);
    return rows.map(fromRow).filter(yield* viewFor(undefined, true));
  });

  const sweep = Effect.gen(function* () {
    const now = yield* nowMs;
    const at = yield* nowIso;
    const all = yield* listAll({
      includeSuperseded: true,
      includeProposed: true,
      limit: 100_000,
    });
    const gone = all.filter((item) => shouldDelete(item, now));
    for (const item of gone) yield* remove(item.id, at);
    return gone.length;
  });

  const flag = Effect.fn("BatonMemoryService.flag")(function* (key: string) {
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM fabric_memory_meta WHERE key = ${`flag:${key}`}`.pipe(Effect.orDie);
    return rows[0]?.value === "1";
  });
  const setFlag = Effect.fn("BatonMemoryService.setFlag")(function* (key: string, on: boolean) {
    yield* sql`INSERT OR REPLACE INTO fabric_memory_meta (key, value) VALUES (${`flag:${key}`}, ${on ? "1" : "0"})`.pipe(
      Effect.orDie,
    );
  });

  const MAX_TALKS = 12;
  const talks = Effect.fn("BatonMemoryService.talks")(function* (day: string) {
    const rows = yield* sql<{ value: string }>`
      SELECT value FROM fabric_memory_meta WHERE key = ${`talks:${day}`}
    `.pipe(Effect.orDie);
    try {
      // @effect-diagnostics-next-line globalJsonInEffect:off - parse failure is caught below.
      return rows[0] === undefined ? [] : (JSON.parse(rows[0].value) as string[]);
    } catch {
      return [];
    }
  });
  const noteTalk = Effect.fn("BatonMemoryService.noteTalk")(function* (day: string, text: string) {
    const held = yield* talks(day);
    if (held.length >= MAX_TALKS) return;
    // @effect-diagnostics-next-line globalJsonInEffect:off - an array of strings.
    yield* sql`INSERT OR REPLACE INTO fabric_memory_meta (key, value) VALUES (${`talks:${day}`}, ${JSON.stringify([...held, text.trim().replace(/\s+/g, " ").slice(0, 80)])})`.pipe(
      Effect.orDie,
    );
  });

  const noteOnce = Effect.fn("BatonMemoryService.noteOnce")(function* (key: string, value: string) {
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM fabric_memory_meta WHERE key = ${`seen:${key}`}`;
    if (rows[0]?.value === value) return false;
    yield* sql`INSERT OR REPLACE INTO fabric_memory_meta (key, value) VALUES (${`seen:${key}`}, ${value})`;
    return true;
  }, Effect.orDie);

  const syncHello = Effect.gen(function* () {
    const rows = yield* sql<{ key: string; value: string }>`
      SELECT key, value FROM fabric_memory_meta WHERE key LIKE 'cursor:%'
    `.pipe(Effect.orDie);
    return {
      origin,
      cursors: Object.fromEntries(rows.map((r) => [r.key.slice("cursor:".length), r.value])),
    };
  });

  const BATCH = 1_000;
  const changesSince = Effect.fn("BatonMemoryService.changesSince")(function* (
    since: string | null,
  ) {
    const from = since ?? "";
    // Paged by when this server got the change, not when its writer made it: a change relayed
    // from a third server can carry an older stamp than a cursor that has already passed.
    const rows = yield* sql<ItemRow & { readonly arrived: string }>`
      SELECT *, COALESCE(received_at, updated_at) AS arrived FROM fabric_memory_items
      WHERE COALESCE(received_at, updated_at) >= ${from} AND proposed = 0
      ORDER BY arrived LIMIT ${BATCH}
    `.pipe(Effect.orDie);
    const stones = yield* sql<{
      id: string;
      deleted_at: string;
      origin: string;
      arrived: string;
    }>`
      SELECT *, COALESCE(received_at, deleted_at) AS arrived FROM fabric_memory_tombstones
      WHERE COALESCE(received_at, deleted_at) >= ${from}
      ORDER BY arrived LIMIT ${BATCH}
    `.pipe(Effect.orDie);
    const seen = yield* viewFor(undefined, true);
    const changes: MemoryChange[] = [
      ...rows
        .map((row) => ({ item: fromRow(row), tombstone: null, writer: row.origin }))
        .filter(({ item }) => seen(item)),
      ...stones.map((s) => ({
        item: null,
        tombstone: { id: s.id, deletedAt: s.deleted_at, origin: s.origin },
        writer: s.origin,
      })),
    ];
    // A full batch means there is more: the peer resumes from the last stamp it was given.
    const full = rows.length === BATCH || stones.length === BATCH;
    const last = [rows.at(-1)?.arrived ?? "", stones.at(-1)?.arrived ?? ""].reduce(
      (a, b) => (a > b ? a : b),
      "",
    );
    return { origin, changes, upTo: full ? last : yield* nowIso };
  });

  const applyChanges = Effect.fn("BatonMemoryService.applyChanges")(function* (
    peer: string,
    changes: ReadonlyArray<MemoryChange>,
    upTo: string,
  ) {
    let applied = 0;
    const at = yield* nowIso;
    for (const change of changes) {
      const id = change.item?.id ?? change.tombstone?.id;
      if (id === undefined || peer === origin) continue;
      // Every received item passes the same door as one he types: a peer is not trusted to have checked.
      if (change.item !== null && refuseToStore(change.item.text, privateTexts()) !== null)
        continue;
      const row = yield* sql<ItemRow>`SELECT * FROM fabric_memory_items WHERE id = ${id}`.pipe(
        Effect.orDie,
      );
      const stone = yield* sql<{ id: string; deleted_at: string; origin: string }>`
        SELECT * FROM fabric_memory_tombstones WHERE id = ${id}
      `.pipe(Effect.orDie);
      const decision = applyDecision(
        {
          item: row[0] === undefined ? null : fromRow(row[0]),
          tombstone:
            stone[0] === undefined
              ? null
              : { id, deletedAt: stone[0].deleted_at, origin: stone[0].origin },
          writer: row[0]?.origin ?? null,
        },
        change,
      );
      if (decision === "ignore") continue;
      yield* sql`DELETE FROM fabric_memory_items WHERE id = ${id}`.pipe(Effect.orDie);
      if (change.tombstone !== null) {
        yield* sql`INSERT OR REPLACE INTO fabric_memory_tombstones (id, deleted_at, origin, received_at) VALUES (${id}, ${change.tombstone.deletedAt}, ${change.tombstone.origin}, ${at})`.pipe(
          Effect.orDie,
        );
        yield* sql`DELETE FROM fabric_memory_uses WHERE item_id = ${id}`.pipe(Effect.orDie);
      } else if (change.item !== null) {
        const i = change.item;
        yield* sql`DELETE FROM fabric_memory_tombstones WHERE id = ${id}`.pipe(Effect.orDie);
        yield* sql`
          INSERT INTO fabric_memory_items (
            id, kind, text, source, source_ref, scope, scope_ref, confidence, pinned, proposed,
            created_at, updated_at, last_used_at, expires_at, superseded_by, origin, received_at
          ) VALUES (
            ${i.id}, ${i.kind}, ${i.text}, ${i.source}, ${i.sourceRef}, ${i.scope}, ${i.scopeRef},
            ${i.confidence}, ${i.pinned ? 1 : 0}, ${i.proposed ? 1 : 0}, ${i.createdAt}, ${i.updatedAt}, ${i.lastUsedAt},
            ${i.expiresAt}, ${i.supersededBy}, ${change.writer}, ${at}
          )
        `.pipe(Effect.orDie);
      }
      applied++;
    }
    // The cursor only moves forward.
    const key = `cursor:${peer}`;
    const held = yield* sql<{
      value: string;
    }>`SELECT value FROM fabric_memory_meta WHERE key = ${key}`.pipe(Effect.orDie);
    if (held[0] === undefined || held[0].value < upTo) {
      yield* sql`INSERT OR REPLACE INTO fabric_memory_meta (key, value) VALUES (${key}, ${upTo})`.pipe(
        Effect.orDie,
      );
    }
    return applied;
  });

  return BatonMemoryService.of({
    origin,
    list,
    search,
    add,
    edit,
    rewrite,
    pin,
    forget,
    accept,
    recall,
    markUsed,
    used,
    exportMarkdown: Effect.map(list({ limit: 100_000, admin: true }), exportMarkdown),
    sweep,
    noteOnce,
    flag,
    setFlag,
    noteTalk,
    talks,
    syncHello,
    changesSince,
    applyChanges,
  });
});

export const layer = Layer.effect(BatonMemoryService, make);
