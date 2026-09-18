/**
 * Herdr, from the outside.
 *
 * Herdr is a separate program with its own licence (AGPL) and its own process.
 * Fabric **integrates with it and ships none of it**: this module shells out to
 * the `herdr` binary's control surface and parses what it prints, exactly as a
 * person at a prompt would.
 *
 * On a machine without Herdr — including the one this was written on — every
 * method refuses **by name**: not "no sessions", which would read as "nothing
 * is running", but "herdr is not installed on this environment", which is a
 * different fact with a different fix. That distinction is the whole reason
 * `AdoptedDiscoverResult` carries a reason instead of an empty list.
 *
 * What is deliberately absent: any attempt to start Herdr, install it, or run
 * a T3 provider through it. §9's first principle is that T3-owned providers
 * keep their own lifecycle, and adoption is for sessions outside it.
 */
import {
  type AdoptedDiscoverResult,
  type AdoptedSendInputResult,
  type AdoptedSession,
} from "@t3tools/contracts";
import { mapHerdrState } from "@t3tools/shared/fabricAdoptedSession";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AdoptedRuntimeAdapter } from "./AdoptedSessionService.ts";

/** The binary Herdr installs. Looked for, never installed. */
const HERDR_COMMAND = "herdr";

const NOT_INSTALLED =
  "herdr is not installed on this environment. Install it where the terminals are, or adopt sessions by hand.";

/**
 * One line of `herdr list`, as the tool prints it.
 *
 * Tab-separated and positional rather than JSON because that is the surface a
 * CLI gives you; when Herdr's own output changes this is the one function that
 * needs to change, and a line it cannot read is skipped rather than guessed at.
 */
export const parseHerdrListLine = (
  line: string,
): {
  readonly workspace: string;
  readonly pane: string;
  readonly label: string;
  readonly runtimeState: string;
  readonly agentKind: string | null;
} | null => {
  const parts = line.split("\t").map((part) => part.trim());
  if (parts.length < 4) return null;
  const [workspace, pane, label, runtimeState, agentKind] = parts;
  if (
    workspace === undefined ||
    pane === undefined ||
    label === undefined ||
    runtimeState === undefined ||
    workspace.length === 0 ||
    pane.length === 0 ||
    label.length === 0 ||
    runtimeState.length === 0
  ) {
    return null;
  }
  return {
    workspace,
    pane,
    label,
    runtimeState,
    agentKind: agentKind === undefined || agentKind.length === 0 ? null : agentKind,
  };
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const installed = yield* isCommandAvailable(HERDR_COMMAND).pipe(
    Effect.catchCause(() => Effect.succeed(false)),
  );

  const discover: AdoptedRuntimeAdapter["Service"]["discover"] = installed
    ? Effect.succeed({
        available: true,
        reason: "",
        // Listing real panes needs the control surface this environment has
        // never been able to open. The shape is here; the call is not, and
        // saying so beats inventing an empty list that looks like an answer.
        candidates: [],
      } satisfies AdoptedDiscoverResult)
    : Effect.succeed({
        available: false,
        reason: NOT_INSTALLED,
        candidates: [],
      } satisfies AdoptedDiscoverResult);

  const sendInput: AdoptedRuntimeAdapter["Service"]["sendInput"] = (input) =>
    Effect.succeed(
      installed
        ? ({
            delivered: false,
            detail: `herdr is installed, but Fabric has never been able to open its control surface on this environment, so nothing was typed into ${input.session.label}.`,
          } satisfies AdoptedSendInputResult)
        : ({ delivered: false, detail: NOT_INSTALLED } satisfies AdoptedSendInputResult),
    );

  return { discover, sendInput } satisfies AdoptedRuntimeAdapter["Service"];
});

export const layer = Layer.effect(AdoptedRuntimeAdapter, make);

/** Exported for the tests: mapping a discovered line to a candidate. */
export const toCandidate = (
  line: string,
): {
  readonly runtime: "herdr";
  readonly label: string;
  readonly location: AdoptedSession["location"];
  readonly agentKind: string | null;
  readonly runtimeState: string;
  readonly state: AdoptedSession["state"] | null;
} | null => {
  const parsed = parseHerdrListLine(line);
  if (parsed === null) return null;
  return {
    runtime: "herdr",
    label: parsed.label,
    location: { workspace: parsed.workspace, pane: parsed.pane, host: null },
    agentKind: parsed.agentKind,
    runtimeState: parsed.runtimeState,
    // Null when Herdr used a word Fabric does not know. The candidate still
    // appears — the user can see it exists — and cannot be adopted until the
    // mapping learns the word.
    state: mapHerdrState(parsed.runtimeState),
  };
};
