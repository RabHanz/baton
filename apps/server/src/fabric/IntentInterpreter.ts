/**
 * The model read of a sentence the grammar could not place (D50).
 *
 * The Director's ruling was blunt: *"don't dumb it down by generic grammar!
 * what the hell even is the point of this if it isn't smart or sentient!"* This
 * is the answer to that, and it is deliberately the *second* answer:
 *
 *   grammar → learned phrasing → model
 *
 * The grammar stays first because it is instant, free and identical every time,
 * and it stays as the verifier because everything a model returns is checked
 * against the same ids and the same §24.1 list the grammar uses
 * (`@t3tools/shared/fabricIntentModel`).
 *
 * Three rules this service follows, and they are the whole design:
 *
 *   1. **It runs as one of the user's own accounts.** The call goes through the
 *      same `TextGeneration` path as thread titles and commit messages, which
 *      spawns their `claude` CLI under their config directory. Subscription,
 *      not API — the Director's rule 2 — and no key of ours anywhere.
 *   2. **It uses the cheapest tier that can classify.** Haiku reads a sentence
 *      against a list of names; the model tier that writes code is not needed
 *      to decide whether "poke the scheduler" is a message or a status
 *      question.
 *   3. **It never reaches a provider that is not there.** No available account
 *      is a refusal by name, not a hang.
 */
import type { FabricIntentResolution } from "@t3tools/contracts";
import {
  buildIntentModelPrompt,
  interpretIntentModelReply,
  type IntentModelReply,
} from "@t3tools/shared/fabricIntentModel";
import type { IntentVocabulary } from "@t3tools/shared/fabricIntentParser";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TextGeneration } from "../textGeneration/TextGeneration.ts";

/**
 * The tier that reads a sentence against a list of names.
 *
 * Named here rather than configured because the choice is a property of the
 * task, not of the deployment: this is classification against a closed
 * vocabulary, the cheapest capable model does it, and anything larger spends
 * the user's quota to arrive at the same answer more slowly.
 */
export const INTENT_MODEL_SLUG = "claude-haiku-4-5";

export interface IntentInterpretation {
  readonly resolution: FabricIntentResolution;
  /** The model that read it, for the record. */
  readonly model: string;
}

export class FabricIntentInterpreter extends Context.Service<
  FabricIntentInterpreter,
  {
    /**
     * Read a sentence the grammar refused. `null` when no account here can do
     * it — the caller keeps the grammar's own refusal, which is more useful
     * than "the model was unavailable".
     */
    readonly interpret: (input: {
      readonly sentence: string;
      readonly vocabulary: IntentVocabulary;
      readonly learned: ReadonlyArray<{ readonly text: string; readonly description: string }>;
    }) => Effect.Effect<IntentInterpretation | null>;
  }
>()("t3/fabric/IntentInterpreter/FabricIntentInterpreter") {}

/**
 * Which account reads the sentence.
 *
 * The first available one, in the order the environment lists them — a stable,
 * boring rule the user can predict. Deliberately not "the busiest" or "the one
 * with most quota": a sentence should not be read by a different account
 * depending on the hour, because the *account* is what the reading is billed
 * to and what its rate limit belongs to.
 */
export const chooseInterpreterInstance = (
  vocabulary: IntentVocabulary,
): { readonly instanceId: string; readonly model: string } | null => {
  const available = vocabulary.providers.find((provider) => provider.available);
  if (available === undefined) return null;
  return { instanceId: available.instanceId, model: INTENT_MODEL_SLUG };
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration;

  const interpret: FabricIntentInterpreter["Service"]["interpret"] = ({
    sentence,
    vocabulary,
    learned,
  }) =>
    Effect.gen(function* () {
      const chosen = chooseInterpreterInstance(vocabulary);
      if (chosen === null) return null;

      const prompt = buildIntentModelPrompt({ sentence, vocabulary, learned });
      const interpretFabricIntent = textGeneration.interpretFabricIntent;
      if (interpretFabricIntent === undefined) return null;

      const reply = yield* interpretFabricIntent({
        sentence,
        prompt,
        modelSelection: {
          instanceId: chosen.instanceId as never,
          model: chosen.model,
          // No option selections: effort, thinking and fast mode are choices
          // about writing code, and this call reads one sentence against a
          // list of names.
          options: [],
        },
      }).pipe(
        // A model that fails, times out or returns nonsense leaves the
        // grammar's refusal standing. It is a worse answer than a good reading
        // and a much better one than a guess.
        Effect.catchCause((cause) =>
          Effect.logWarning("Fabric could not read a sentence with a model", {
            sentence,
            cause,
          }).pipe(Effect.as(null)),
        ),
      );
      if (reply === null) return null;

      const resolution = interpretIntentModelReply({
        sentence,
        // The driver's result is structurally this shape; the fields it names
        // are checked against the environment inside `interpretIntentModelReply`,
        // which is where every id becomes real or the sentence is refused.
        reply: reply as IntentModelReply,
        vocabulary,
      });

      return { resolution, model: chosen.model } satisfies IntentInterpretation;
    });

  return { interpret } satisfies FabricIntentInterpreter["Service"];
});

export const layer = Layer.effect(FabricIntentInterpreter, make);
