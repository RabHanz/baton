/**
 * Which model a step uses (D148): judgment and planning on the strong one, mechanical and repeatable
 * work on the cheap one. A table he can edit (`routing.json` in his operating-system folder) names
 * the two models; this decides which a step gets.
 */
export interface Routing {
  readonly strong: string;
  readonly cheap: string;
}

/** Aliases the Claude command line accepts, so they follow the newest model of each size. */
export const DEFAULT_ROUTING: Routing = { strong: "opus", cheap: "haiku" };

export type StepKind = "planning" | "judgment" | "routine";

export const modelFor = (kind: StepKind, routing: Routing): string =>
  kind === "routine" ? routing.cheap : routing.strong;

/** A user's table over the default; anything that is not a short model name is ignored. */
export const parseRouting = (text: string | undefined): Routing => {
  if (text === undefined) return DEFAULT_ROUTING;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_ROUTING;
  }
  const given = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const name = (v: unknown, fallback: string) =>
    typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,60}$/.test(v) ? v : fallback;
  return {
    strong: name(given["strong"], DEFAULT_ROUTING.strong),
    cheap: name(given["cheap"], DEFAULT_ROUTING.cheap),
  };
};
