/**
 * The phrasings this user has actually used, and what they meant.
 *
 * The point of putting a model on the intent path (D50) is not to leave it
 * there. A sentence the grammar could not place, read by a model, shown to the
 * user and then *acted on* is a sentence the user meant — and the next time
 * they say it there is no reason to spend a model call, a second of latency, or
 * a different answer on it. So it is remembered, keyed by the normalised text,
 * and consulted before the model and after the grammar.
 *
 * Three properties this deliberately has:
 *
 *   1. **It only learns from execution.** A resolution that was previewed and
 *      abandoned teaches nothing — the user walking away is the closest thing
 *      to a "no" this surface gets.
 *   2. **It stores the command, not the reply.** Replies contain the state of
 *      the world at the time; the command is the meaning.
 *   3. **It is inspectable and deletable by row.** A learned phrasing that
 *      turns out wrong is one `DELETE` away, and `model` is on the row so a bad
 *      batch can be found by the model that produced it.
 */
import {
  FabricIntentRisk,
  IsoDateTime,
  TrimmedNonEmptyString,
  WorkSessionId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "../persistence/Errors.ts";

export const FabricLearnedIntentRow = Schema.Struct({
  /** Lower-cased, punctuation-stripped, whitespace-collapsed. The lookup key. */
  normalisedText: TrimmedNonEmptyString,
  /** What the user actually said, for a reader. */
  text: TrimmedNonEmptyString,
  /** The command, as JSON. Decoded against `FabricIntentCommand` on read. */
  commandJson: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  risk: FabricIntentRisk,
  workSessionId: Schema.NullOr(WorkSessionId),
  model: TrimmedNonEmptyString,
  learnedAt: IsoDateTime,
  usedCount: Schema.Int,
  lastUsedAt: Schema.NullOr(IsoDateTime),
});
export type FabricLearnedIntentRow = typeof FabricLearnedIntentRow.Type;

export class FabricIntentVocabularyRepository extends Context.Service<
  FabricIntentVocabularyRepository,
  {
    readonly find: (
      normalisedText: string,
    ) => Effect.Effect<FabricLearnedIntentRow | null, ProjectionRepositoryError>;
    /** Newest first. Used for the prompt's few-shot examples and for a reader. */
    readonly list: (
      limit: number,
    ) => Effect.Effect<ReadonlyArray<FabricLearnedIntentRow>, ProjectionRepositoryError>;
    readonly learn: (
      row: Omit<FabricLearnedIntentRow, "usedCount" | "lastUsedAt">,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly markUsed: (input: {
      readonly normalisedText: string;
      readonly at: string;
    }) => Effect.Effect<void, ProjectionRepositoryError>;
  }
>()("t3/fabric/IntentVocabularyRepository/FabricIntentVocabularyRepository") {}

const COLUMNS = `
  normalised_text AS "normalisedText",
  text,
  command_json AS "commandJson",
  description,
  risk,
  work_session_id AS "workSessionId",
  model,
  learned_at AS "learnedAt",
  used_count AS "usedCount",
  last_used_at AS "lastUsedAt"
`;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selectOne = SqlSchema.findAll({
    Request: Schema.Struct({ normalisedText: Schema.String }),
    Result: FabricLearnedIntentRow,
    execute: ({ normalisedText }) => sql`
      SELECT ${sql.literal(COLUMNS)}
      FROM fabric_intent_vocabulary
      WHERE normalised_text = ${normalisedText}
    `,
  });

  const selectRecent = SqlSchema.findAll({
    Request: Schema.Struct({ limit: Schema.Int }),
    Result: FabricLearnedIntentRow,
    execute: ({ limit }) => sql`
      SELECT ${sql.literal(COLUMNS)}
      FROM fabric_intent_vocabulary
      ORDER BY learned_at DESC
      LIMIT ${limit}
    `,
  });

  const fail = (operation: string) => toPersistenceSqlError(operation);

  const find: FabricIntentVocabularyRepository["Service"]["find"] = (normalisedText) =>
    selectOne({ normalisedText }).pipe(
      Effect.mapError(fail("FabricIntentVocabularyRepository.find")),
      Effect.map((rows) => rows[0] ?? null),
    );

  const list: FabricIntentVocabularyRepository["Service"]["list"] = (limit) =>
    selectRecent({ limit }).pipe(Effect.mapError(fail("FabricIntentVocabularyRepository.list")));

  const learn: FabricIntentVocabularyRepository["Service"]["learn"] = (row) =>
    sql`
      INSERT INTO fabric_intent_vocabulary (
        normalised_text, text, command_json, description, risk,
        work_session_id, model, learned_at, used_count, last_used_at
      ) VALUES (
        ${row.normalisedText}, ${row.text}, ${row.commandJson}, ${row.description}, ${row.risk},
        ${row.workSessionId}, ${row.model}, ${row.learnedAt}, 0, NULL
      )
      ON CONFLICT(normalised_text) DO UPDATE SET
        text = excluded.text,
        command_json = excluded.command_json,
        description = excluded.description,
        risk = excluded.risk,
        work_session_id = excluded.work_session_id,
        model = excluded.model,
        learned_at = excluded.learned_at
    `.pipe(Effect.mapError(fail("FabricIntentVocabularyRepository.learn")), Effect.asVoid);

  const markUsed: FabricIntentVocabularyRepository["Service"]["markUsed"] = ({
    normalisedText,
    at,
  }) =>
    sql`
      UPDATE fabric_intent_vocabulary
      SET used_count = used_count + 1, last_used_at = ${at}
      WHERE normalised_text = ${normalisedText}
    `.pipe(Effect.mapError(fail("FabricIntentVocabularyRepository.markUsed")), Effect.asVoid);

  return {
    find,
    list,
    learn,
    markUsed,
  } satisfies FabricIntentVocabularyRepository["Service"];
});

export const layer = Layer.effect(FabricIntentVocabularyRepository, make);
