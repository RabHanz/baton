/**
 * Herdr, from the outside.
 *
 * Herdr is a separate program with its own licence (AGPL) and its own process.
 * Fabric **integrates with it and ships none of it**: this module shells out to
 * the `herdr` binary's socket-API commands and reads what they print, exactly
 * as a person at a prompt would.
 *
 * On a machine without Herdr — which is where this was first written — every
 * method refuses **by name**: not "no sessions", which would read as "nothing
 * is running", but "herdr is not installed on this environment", which is a
 * different fact with a different fix. A third case sits between them and is
 * the one that actually bit: Herdr installed with **no server running**. Its
 * CLI then exits non-zero, and reporting that as "not installed" would send
 * somebody to reinstall a binary that is already there.
 *
 * The surface is JSON, not a table. An earlier version of this file parsed a
 * tab-separated `herdr list` that does not exist in 0.9.1 — written against a
 * plausible CLI rather than the real one, and it would have found nothing
 * forever while looking like it worked. Every command used here was run against
 * the installed binary before it was written down:
 *
 *   herdr pane list        → {"result":{"panes":[{pane_id,workspace_id,cwd,…}]}}
 *   herdr workspace list   → {"result":{"workspaces":[{workspace_id,label,…}]}}
 *   herdr agent list       → {"result":{"agents":[…]}}
 *   herdr pane send-text   → literal text into a pane
 *   herdr pane send-keys   → key presses, `enter` being the submit
 *
 * What is deliberately absent: any attempt to start Herdr, install it, or run
 * a T3 provider through it. §9's first principle is that T3-owned providers
 * keep their own lifecycle, and adoption is for sessions outside it.
 */
import {
  type AdoptedDiscoverResult,
  type AdoptedSendInputResult,
  type AdoptedSession,
  type AdoptedSessionCandidate,
} from "@t3tools/contracts";
import { mapHerdrState } from "@t3tools/shared/fabricAdoptedSession";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import { AdoptedRuntimeAdapter } from "./AdoptedSessionService.ts";

/** The binary Herdr installs. Looked for, never installed. */
const HERDR_COMMAND = "herdr";

const NOT_INSTALLED =
  "herdr is not installed on this environment. Install it where the terminals are, or adopt sessions by hand.";

/**
 * A pane can be listed long before anything is typed into it, so a request that
 * hangs must not hang the fleet with it. Herdr answers a local socket in
 * milliseconds; ten seconds is a hung socket, not a slow one.
 */
const HERDR_TIMEOUT = "10 seconds";

/**
 * Herdr's own status words, from its bundled schema at protocol 22:
 * `idle | working | blocked | done | unknown`. §9's mapping covers the first
 * four; `unknown` maps to null, which is the honest answer — the candidate is
 * listed, and cannot be adopted until Fabric knows what the word means.
 */
const PaneEntry = Schema.Struct({
  pane_id: Schema.String,
  workspace_id: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  agent_status: Schema.optional(Schema.String),
});

const WorkspaceEntry = Schema.Struct({
  workspace_id: Schema.String,
  label: Schema.optional(Schema.String),
});

/**
 * `agent_status` is the field Herdr 0.9.1 actually prints — checked against a
 * live `claude` agent, which reported `{"agent":"claude","agent_status":
 * "blocked","pane_id":"w1:p2","name":"fabric-proof"}`. `status` is tolerated
 * because the pane listing uses the shorter spelling elsewhere, and reading
 * only the name I first guessed would have silently produced "unknown" for
 * every agent on the machine.
 */
const AgentEntry = Schema.Struct({
  pane_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  agent_status: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});

const PaneList = Schema.Struct({
  result: Schema.Struct({ panes: Schema.Array(PaneEntry) }),
});
const WorkspaceList = Schema.Struct({
  result: Schema.Struct({ workspaces: Schema.Array(WorkspaceEntry) }),
});
const AgentList = Schema.Struct({
  result: Schema.Struct({ agents: Schema.Array(AgentEntry) }),
});

const decodePaneList = Schema.decodeUnknownOption(PaneList);
const decodeWorkspaceList = Schema.decodeUnknownOption(WorkspaceList);
const decodeAgentList = Schema.decodeUnknownOption(AgentList);

/**
 * Herdr prints one JSON object per command, but a wrapper or a warning line can
 * precede it. Take the last line that parses rather than assuming the first.
 */
export const parseHerdrJson = (stdout: string): unknown => {
  let parsed: unknown = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith("{")) continue;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
  }
  return parsed;
};

/** One pane, described the way §9's candidate wants it. */
export const paneCandidate = (input: {
  readonly paneId: string;
  readonly workspaceLabel: string;
  readonly cwd: string | null;
  readonly agentKind: string | null;
  readonly runtimeState: string;
}): AdoptedSessionCandidate => ({
  runtime: "herdr",
  // The pane's directory is what tells two otherwise identical panes apart, so
  // it leads the label when there is no agent to name.
  label:
    input.agentKind === null
      ? `${input.workspaceLabel} · ${input.cwd ?? input.paneId}`
      : `${input.agentKind} · ${input.workspaceLabel}`,
  location: { workspace: input.workspaceLabel, pane: input.paneId, host: null },
  agentKind: input.agentKind,
  runtimeState: input.runtimeState,
  state: mapHerdrState(input.runtimeState),
});

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const installed = yield* isCommandAvailable(HERDR_COMMAND).pipe(
    Effect.catchCause(() => Effect.succeed(false)),
  );

  /** Run one Herdr command. Never throws: a refusal is a normal answer here. */
  const herdr = (args: ReadonlyArray<string>) =>
    runner
      .run({
        command: HERDR_COMMAND,
        args,
        timeout: HERDR_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((output) => ({
          ok: output.code === 0 && !output.timedOut,
          stdout: output.stdout,
          stderr: output.stderr.trim(),
        })),
        Effect.catchCause(() => Effect.succeed({ ok: false, stdout: "", stderr: "" })),
      );

  const discover: AdoptedRuntimeAdapter["Service"]["discover"] = Effect.gen(function* () {
    if (!installed) {
      return {
        available: false,
        reason: NOT_INSTALLED,
        candidates: [],
      } satisfies AdoptedDiscoverResult;
    }

    const panes = yield* herdr(["pane", "list"]);
    if (!panes.ok) {
      // Installed but unreachable. Saying "not installed" here would send
      // somebody to reinstall a binary that is already on the machine.
      return {
        available: false,
        reason:
          panes.stderr.length === 0
            ? "herdr is installed but its server is not answering. Start a Herdr session on this machine, then look again."
            : `herdr is installed but its server did not answer: ${panes.stderr}`,
        candidates: [],
      } satisfies AdoptedDiscoverResult;
    }

    const paneList = decodePaneList(parseHerdrJson(panes.stdout));
    if (paneList._tag === "None") {
      return {
        available: false,
        reason: "herdr answered in a shape Fabric does not recognise, so nothing was adopted.",
        candidates: [],
      } satisfies AdoptedDiscoverResult;
    }

    // Workspace labels and agents are enrichment: a pane is still adoptable
    // when either call fails, so neither failure takes the listing down.
    const workspaces = yield* herdr(["workspace", "list"]);
    const workspaceLabels = new Map<string, string>();
    if (workspaces.ok) {
      const decoded = decodeWorkspaceList(parseHerdrJson(workspaces.stdout));
      if (decoded._tag === "Some") {
        for (const workspace of decoded.value.result.workspaces) {
          workspaceLabels.set(workspace.workspace_id, workspace.label ?? workspace.workspace_id);
        }
      }
    }

    const agents = yield* herdr(["agent", "list"]);
    const agentByPane = new Map<string, { kind: string | null; status: string | null }>();
    if (agents.ok) {
      const decoded = decodeAgentList(parseHerdrJson(agents.stdout));
      if (decoded._tag === "Some") {
        for (const agent of decoded.value.result.agents) {
          if (agent.pane_id === undefined) continue;
          agentByPane.set(agent.pane_id, {
            kind: agent.agent ?? agent.name ?? null,
            status: agent.agent_status ?? agent.status ?? null,
          });
        }
      }
    }

    const candidates = paneList.value.result.panes.map((pane) => {
      const agent = agentByPane.get(pane.pane_id) ?? null;
      const workspaceId = pane.workspace_id ?? "";
      return paneCandidate({
        paneId: pane.pane_id,
        workspaceLabel: workspaceLabels.get(workspaceId) ?? workspaceId,
        cwd: pane.cwd ?? null,
        agentKind: agent?.kind ?? null,
        runtimeState: agent?.status ?? pane.agent_status ?? "unknown",
      });
    });

    return { available: true, reason: "", candidates } satisfies AdoptedDiscoverResult;
  });

  const sendInput: AdoptedRuntimeAdapter["Service"]["sendInput"] = (input) =>
    Effect.gen(function* () {
      if (!installed) {
        return { delivered: false, detail: NOT_INSTALLED } satisfies AdoptedSendInputResult;
      }
      const pane = input.session.location.pane;
      const typed = yield* herdr(["pane", "send-text", pane, input.text]);
      if (!typed.ok) {
        return {
          delivered: false,
          detail:
            typed.stderr.length === 0
              ? `herdr refused to type into ${input.session.label}.`
              : `herdr refused to type into ${input.session.label}: ${typed.stderr}`,
        } satisfies AdoptedSendInputResult;
      }
      if (!input.submit) {
        return {
          delivered: true,
          detail: `Typed into ${input.session.label} without submitting.`,
        } satisfies AdoptedSendInputResult;
      }
      // Submitting is a second call on purpose: the text landing and the return
      // key landing are different facts, and reporting them as one would claim
      // a prompt ran when only the typing did.
      const submitted = yield* herdr(["pane", "send-keys", pane, "enter"]);
      return submitted.ok
        ? ({
            delivered: true,
            detail: `Sent to ${input.session.label}.`,
          } satisfies AdoptedSendInputResult)
        : ({
            delivered: false,
            detail: `Typed into ${input.session.label}, but herdr refused the return key, so nothing was submitted.`,
          } satisfies AdoptedSendInputResult);
    });

  return { discover, sendInput } satisfies AdoptedRuntimeAdapter["Service"];
});

export const layer = Layer.effect(AdoptedRuntimeAdapter, make);
