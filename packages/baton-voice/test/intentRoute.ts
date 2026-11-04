/** The cheap, model-free part of routing a spoken sentence: what the rules decide before any model is asked. */
import { decide } from "@t3tools/baton-shared/brain";
import { resolveBatonIntent } from "@t3tools/baton-shared/intentParser";
import { isCancelPhrase, isDismissPhrase } from "@t3tools/baton-shared/voiceTurn";

import { stripWake } from "../src/modeMachine.ts";

import { fleet } from "./grammarClient.ts";

/**
 * "cancel" and "dismiss" are the two spoken endings; "<route>:instant|grammar|guard" is a rule that
 * placed the sentence; "model" means no rule did, so a model has to decide.
 */
export const ruleRoute = async (said: string): Promise<string> => {
  // The voice core strips the wake word before either check, so the rows can say one.
  const words = stripWake(said, ["baton", "jarvis", "alfred", "freya", "tessaya"]);
  if (isCancelPhrase(words)) return "cancel";
  if (isDismissPhrase(said)) return "dismiss";
  const decision = await decide(
    said,
    { running: null, direct: false, recent: [] },
    {
      ask: () => Promise.reject(new Error("no model")),
      grammarPlaces: async () => resolveBatonIntent(said, fleet).outcome === "resolved",
    },
  );
  return decision.source === "fallback" ? "model" : `${decision.route}:${decision.source}`;
};
