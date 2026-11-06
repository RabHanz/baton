/**
 * Which model answers a chat turn. Simple turns (the time, what needs him, a yes) go to the fast
 * model, most to the middle one, and planning or a chain of actions to the strongest. The persona's
 * own model is the ceiling: a turn never runs above it. Rules, not a model call: deciding must cost
 * nothing, or the fast path is not fast.
 */
import type { Brain } from "./osPack.ts";

export type TurnTier = "fast" | "default" | "deep";

export interface TurnChoice {
  readonly tier: TurnTier;
  readonly brain: Brain;
  /** In a few words, for the turn log. */
  readonly why: string;
}

/** The model a tier asks for. Effort for the strongest is the persona's own. */
const TIER_MODEL: Readonly<Record<TurnTier, string>> = {
  fast: "haiku",
  default: "sonnet",
  deep: "opus",
};
const RANK: Readonly<Record<string, number>> = { haiku: 0, sonnet: 1, opus: 2 };
const TIERS: ReadonlyArray<TurnTier> = ["fast", "default", "deep"];

/** A yes, a no or a thanks: the turn before it decides how much thought it needs. */
const REPLY_ONLY =
  /^(?:yes|yeah|yep|yup|no|nope|ok|okay|sure|right|fine|alright|thanks|thank you|cheers|great|perfect|cool|nice|lovely|got it|go ahead|go on|do it|do that|please|please do|sounds good|that's fine|not now|never mind|cancel|hang on|wait)(?: (?:please|then|thanks|thank you|go ahead|do it|mate))*$/;
const CLOCK =
  /\b(?:what(?:'s| is) the (?:time|date|day)|what time is it|what day is (?:it|today)|what(?:'s| is) today(?:'s date)?|what's the date)\b/;
/** Questions one read-only tool answers. */
const STATUS =
  /\b(?:what needs (?:me|my)|needs me|needs my (?:attention|approval|eyes)|anything stuck|is anything (?:stuck|broken|waiting)|what(?:'s| is) (?:every(?:one|body)|the team) (?:working on|doing)|what happened (?:overnight|today|while i was away)|how(?:'s| is) (?:it|everything|the \w+) going|any (?:news|updates?))\b/;
const GREETING =
  /^(?:hi|hello|hey|morning|good (?:morning|afternoon|evening|night)|how are you(?: doing| today)?|you there|are you there)$/;
const QUESTION_START =
  /^(?:what|what's|whats|who|who's|when|where|which|how many|how much|how old|how far|how long|is|are|was|does|do|did|can you tell me)\b/;
/** Doing something, or looking at the screen: never the fast model. */
const ACTION =
  /\b(?:type|click|press|open|close|save|send|tell|ask|start|stop|make|create|write|draft|edit|change|move|delete|remove|fix|run|book|buy|pay|install|remind|schedule|set|turn|switch|fill|copy|paste|reply|email|message|post|split|screen|monitor|window|see|look|showing|teach)\b/;
/** Planning, research or a judgement call. */
const DEEP =
  /\b(?:plan|planning|figure out|work out|think through|break (?:it|this|that) down|strategy|strategi[sz]e|organi[sz]e|prioriti[sz]e|take on a job|job|split (?:it|the|this)|for me|step by step|research|investigate|compare|review|refactor|migrate|debug|should i|what do you think|your (?:advice|opinion|view)|pros and cons|trade.?offs?|decide|weigh up)\b/;
/** Two actions in one breath: a chain of tool calls. */
const CHAIN =
  /\b(?:and then|then|and (?:save|send|close|open|press|click|type|tell|email|post|reply))\b/;

const words = (text: string): number => text.split(" ").filter(Boolean).length;

const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The tier this sentence needs on its own, and why. */
export const tierOfSentence = (said: string): { readonly tier: TurnTier; readonly why: string } => {
  const t = plain(said);
  if (words(t) > 30) return { tier: "deep", why: "long request" };
  if (DEEP.test(t)) return { tier: "deep", why: "planning or judgement" };
  if (ACTION.test(t) && CHAIN.test(t)) return { tier: "deep", why: "several steps" };
  if (CLOCK.test(t)) return { tier: "fast", why: "time or date" };
  if (STATUS.test(t)) return { tier: "fast", why: "status" };
  if (GREETING.test(t)) return { tier: "fast", why: "greeting" };
  if (REPLY_ONLY.test(t)) return { tier: "fast", why: "short reply" };
  if (QUESTION_START.test(t) && words(t) <= 8 && !ACTION.test(t))
    return { tier: "fast", why: "short question" };
  return { tier: "default", why: "default" };
};

/** The persona's own model as a tier, or null for a model these rules do not know (kept as it is). */
const ceilingOf = (brain: Brain): TurnTier | null => {
  const name = Object.keys(RANK).find((alias) => brain.model.toLowerCase().includes(alias));
  return name === undefined ? null : TIERS[RANK[name]!]!;
};

const brainFor = (tier: TurnTier, ceiling: Brain): Brain =>
  tier === "deep"
    ? ceiling
    : { model: TIER_MODEL[tier], effort: tier === "fast" ? "low" : "medium" };

/**
 * The model for this turn, at most the persona's own. A bare yes or thanks right after a turn keeps
 * that turn's tier, so "go ahead" to a plan is carried out by the model that made it.
 */
export const chooseTurnBrain = (
  said: string,
  ceiling: Brain,
  previous: TurnTier | null = null,
): TurnChoice => {
  const top = ceilingOf(ceiling);
  if (top === null) return { tier: "deep", brain: ceiling, why: "persona's own model" };
  const own = tierOfSentence(said);
  const picked =
    previous !== null && own.why === "short reply"
      ? { tier: previous, why: "answers the last turn" }
      : own;
  const tier = TIERS[Math.min(TIERS.indexOf(picked.tier), TIERS.indexOf(top))]!;
  return {
    tier,
    brain: tier === top ? ceiling : brainFor(tier, ceiling),
    why: tier === picked.tier ? picked.why : `${picked.why}, capped at the persona's model`,
  };
};

/** Every model a persona's turns can land on, so each can be kept warm. */
export const tierBrains = (ceiling: Brain): ReadonlyArray<Brain> => {
  const top = ceilingOf(ceiling);
  if (top === null) return [ceiling];
  return TIERS.slice(0, TIERS.indexOf(top) + 1).map((tier) =>
    tier === top ? ceiling : brainFor(tier, ceiling),
  );
};
