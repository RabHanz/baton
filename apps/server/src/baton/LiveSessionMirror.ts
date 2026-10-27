/* oxlint-disable t3code/no-low-value-comments, t3code/prefer-effect-fn -- Baton file (D82) */
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off preferSchemaOverJson:off effectFnOpportunity:off
/**
 * Every live Claude Code session as an ordinary T3 thread (D83).
 *
 * T3's official apps (phone, desktop, app.t3.codes) render threads from the server's read model
 * and nothing else, so this is where a session started in a plain terminal, VS Code or Herdr has
 * to become one. Each session in the registry (`~/.claude/sessions/<pid>.json`, D68) gets a thread
 * under the T3 project its directory belongs to, written with the same events upstream's own
 * agent-session import writes, and its transcript is followed so new messages arrive as they are
 * written. The thread's provider is the "Live session" instance: T3's own ACP Registry driver
 * running `scripts/baton/live/baton-live-acp.mjs`, so the composer's send becomes a turn that
 * types into the session's Herdr pane (adopting it first when needed).
 *
 * Identity is the Claude conversation id: `baton-live:<session id>`. Account rotation and Herdr
 * adoption both reopen the same conversation id (D69, D74), so the thread stays the same thread.
 * A session T3 already owns (its SDK sessions, or one imported by upstream's importer) is never
 * mirrored a second time.
 *
 * Ordering: runless items sort before every run, so a message written after a composer turn is
 * attached to the thread's latest run and lands after it.
 *
 * shortcut: polls the registry and each transcript every 2 s rather than watching files; a tick
 * costs a directory read plus one `stat` per live session. Upgrade to fs.watch if ticks show up.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  EventId,
  MessageId,
  type ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type OrchestrationProjectShell,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
  type RunId,
} from "@t3tools/contracts";
import type { ClaudeLiveSession } from "@t3tools/baton-contracts";
import {
  claudeProjectSlug,
  isComposerEcho,
  parseLiveTranscriptLine,
  splitTranscriptChunk,
  type LiveTranscriptMessage,
} from "@t3tools/baton-shared/liveTranscript";
import { derive as deriveIds } from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { ServerSettingsService } from "../serverSettings.ts";
import { BatonEngine } from "./BatonEngine.ts";
import { readClaudeLiveSessions } from "./ClaudeLiveSessions.ts";
import { projectRefFor } from "./ProjectRef.ts";

export const LIVE_INSTANCE_ID = ProviderInstanceId.make("baton-live");
const DRIVER = ProviderDriverKind.make("acpRegistry");
const MODEL = "live";
const PREFIX = "baton-live";
const TICK = "2 seconds";
/** How much of an existing transcript a new thread starts with. */
const FIRST_READ_BYTES = 4 * 1024 * 1024;
const FIRST_MESSAGES = 120;
/** A busy session can write a lot between ticks; one tick reads at most this much. */
const STEP_BYTES = 8 * 1024 * 1024;

/** Off by machine with `BATON_LIVE_THREADS=off`. */
export const liveThreadsEnabled = (): boolean => process.env.BATON_LIVE_THREADS !== "off";

export const liveThreadId = (sessionId: string): ThreadId =>
  ThreadId.make(`${PREFIX}:${sessionId}`);

const agentScript = (): string =>
  process.env.BATON_LIVE_ACP ??
  NodePath.join(NodeOS.homedir(), ".t3", "baton", "baton-live-acp.mjs");

/** A Node for the agent: T3 itself is a single executable, so it cannot run a script. */
export const findNode = (): string | null => {
  const home = NodeOS.homedir();
  const nvm = NodePath.join(home, ".nvm", "versions", "node");
  let nvmNodes: Array<string> = [];
  try {
    nvmNodes = NodeFS.readdirSync(nvm)
      .toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => NodePath.join(nvm, version, "bin", "node"));
  } catch {}
  const candidates = [
    process.env.BATON_LIVE_NODE,
    NodePath.join(home, ".t3", "baton", "node"),
    NodePath.join(home, "bin", "node"),
    ...nvmNodes,
    "/usr/local/bin/node",
    "/usr/bin/node",
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.length === 0) continue;
    try {
      NodeFS.accessSync(candidate, NodeFS.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
};

/** The project a session's directory belongs to: deepest root that contains it, then same repo. */
export const projectForDirectory = (
  cwd: string,
  projects: ReadonlyArray<
    Pick<OrchestrationProjectShell, "id" | "workspaceRoot" | "repositoryIdentity">
  >,
  repositoryKey: string | null,
): ProjectId | null => {
  const inside = projects
    .filter(
      (p) => cwd === p.workspaceRoot || cwd.startsWith(`${p.workspaceRoot.replace(/\/$/, "")}/`),
    )
    .toSorted((a, b) => b.workspaceRoot.length - a.workspaceRoot.length);
  if (inside[0] !== undefined) return inside[0].id;
  if (repositoryKey === null) return null;
  return projects.find((p) => p.repositoryIdentity?.canonicalKey === repositoryKey)?.id ?? null;
};

/** Claude Code keeps a conversation at `<config>/projects/<slug>/<id>.jsonl`. */
const transcriptPath = (session: ClaudeLiveSession): string | null => {
  const root = NodePath.join(NodeOS.homedir(), ".claude", "projects");
  const direct = NodePath.join(root, claudeProjectSlug(session.cwd), `${session.sessionId}.jsonl`);
  if (NodeFS.existsSync(direct)) return direct;
  try {
    for (const dir of NodeFS.readdirSync(root)) {
      const candidate = NodePath.join(root, dir, `${session.sessionId}.jsonl`);
      if (NodeFS.existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
};

const readRange = (path: string, from: number, to: number): string => {
  const fd = NodeFS.openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, to - from));
    const read = NodeFS.readSync(fd, buffer, 0, buffer.length, from);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    NodeFS.closeSync(fd);
  }
};

interface Follow {
  readonly threadId: ThreadId;
  path: string | null;
  offset: number;
  rest: string;
  readonly written: Set<string>;
}

const make = Effect.gen(function* () {
  const engine = yield* BatonEngine;
  const settings = yield* ServerSettingsService;

  const follows = new Map<string, Follow>();
  /** Sessions another T3 thread owns, so Baton stays out of them. */
  const owned = new Set<string>();

  const ensureProviderInstance = Effect.gen(function* () {
    const script = agentScript();
    const node = findNode();
    if (!NodeFS.existsSync(script) || node === null) {
      yield* Effect.logWarning("Baton live threads: no agent script or Node, sending is off", {
        script,
        node,
      });
      return;
    }
    const wanted = {
      driver: DRIVER,
      displayName: "Live session",
      enabled: true,
      config: { source: "local", commandPath: node, commandArgs: [script], customModels: [MODEL] },
    };
    const current = (yield* settings.getSettings).providerInstances[LIVE_INSTANCE_ID];
    if (JSON.stringify(current) === JSON.stringify(wanted)) return;
    yield* settings.updateProviderInstance({
      operation: "upsert",
      instanceId: LIVE_INSTANCE_ID,
      instance: wanted,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Baton live threads: provider setup failed", cause),
    ),
  );

  const projectFor = (session: ClaudeLiveSession) =>
    Effect.gen(function* () {
      const projects = yield* engine.projects;
      const { key: repositoryRef, label } = yield* projectRefFor(session.cwd);
      const repositoryKey = repositoryRef.startsWith("dir:") ? null : repositoryRef;
      const found = projectForDirectory(session.cwd, projects, repositoryKey);
      if (found !== null) return { projectId: found, projects };
      const created = yield* engine.createProject({
        tag: "live",
        title: label,
        workspaceRoot: session.cwd,
      });
      return { projectId: created, projects: yield* engine.projects };
    });

  const createThread = (session: ClaudeLiveSession, threadId: ThreadId, title: string) =>
    Effect.gen(function* () {
      const { projectId, projects } = yield* projectFor(session);
      if (projectId === null) return;
      const project = projects.find((p) => p.id === projectId);
      const now = yield* DateTime.now;
      const providerThreadId = deriveIds.providerThread({
        driver: DRIVER,
        providerInstanceId: LIVE_INSTANCE_ID,
        nativeThreadId: session.sessionId,
      });
      const root = project?.workspaceRoot ?? session.cwd;
      const appThread: OrchestrationV2AppThread = {
        createdBy: "system",
        creationSource: "server",
        id: threadId,
        projectId,
        title,
        providerInstanceId: LIVE_INSTANCE_ID,
        modelSelection: { instanceId: LIVE_INSTANCE_ID, model: MODEL },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: session.cwd === root ? null : session.cwd,
        linkedPullRequest: null,
        branchPullRequest: null,
        activeProviderThreadId: providerThreadId,
        // Runless items are history, the same as upstream's import.
        historyOrigin: "v1_import",
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        activeOrderKey: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      const providerThread: OrchestrationV2ProviderThread = {
        id: providerThreadId,
        driver: DRIVER,
        providerInstanceId: LIVE_INSTANCE_ID,
        providerSessionId: null,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: { driver: DRIVER, nativeId: session.sessionId, strength: "strong" },
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        createdAt: now,
        updatedAt: now,
      };
      yield* engine.writeEvents({
        unlessNativeThreadOwned: providerThread,
        events: [
          {
            id: EventId.make(`${PREFIX}:thread:${threadId}:created`),
            type: "thread.created",
            threadId,
            providerInstanceId: LIVE_INSTANCE_ID,
            occurredAt: now,
            payload: appThread,
          },
          {
            id: EventId.make(`${PREFIX}:provider-thread:${providerThreadId}`),
            type: "provider-thread.updated",
            threadId,
            driver: DRIVER,
            providerInstanceId: LIVE_INSTANCE_ID,
            occurredAt: now,
            payload: providerThread,
          },
        ],
      });
    });

  const messageEvents = (
    threadId: ThreadId,
    sessionId: string,
    message: LiveTranscriptMessage,
    runId: RunId | null,
  ): ReadonlyArray<OrchestrationV2DomainEvent> => {
    const key = `${sessionId}:${message.uuid}`;
    const messageId = MessageId.make(`${PREFIX}:${key}`);
    const at = DateTime.makeUnsafe(message.createdAt);
    const common = {
      id: TurnItemId.make(`${PREFIX}:turn-item:${key}`),
      threadId,
      runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      // The position store replaces this with the next place in the thread.
      ordinal: 1,
      status: "completed" as const,
      title: null,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
    };
    return [
      {
        id: EventId.make(`${PREFIX}:message:${key}`),
        type: "message.updated",
        threadId,
        occurredAt: at,
        payload: {
          createdBy: message.role === "user" ? "user" : "agent",
          creationSource: "server",
          id: messageId,
          threadId,
          runId,
          nodeId: null,
          role: message.role,
          text: message.text,
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      },
      {
        id: EventId.make(`${PREFIX}:turn-item:${key}`),
        type: "turn-item.updated",
        threadId,
        occurredAt: at,
        payload:
          message.role === "user"
            ? {
                ...common,
                createdBy: "user",
                creationSource: "server",
                type: "user_message",
                messageId,
                inputIntent: "turn_start",
                text: message.text,
                attachments: [],
              }
            : {
                ...common,
                type: "assistant_message",
                messageId,
                text: message.text,
                streaming: false,
              },
      },
    ];
  };

  /** Messages the thread already shows: Baton's own copies, and what T3's composer sent. */
  const threadMessages = (threadId: ThreadId) => engine.threadMessages(threadId, 400);

  const writeMessages = (
    follow: Follow,
    sessionId: string,
    messages: ReadonlyArray<LiveTranscriptMessage>,
  ) =>
    Effect.gen(function* () {
      const fresh = messages.filter((m) => !follow.written.has(m.uuid));
      if (fresh.length === 0) return;
      const shell = yield* engine.threadShell(follow.threadId);
      const runId = shell?.latestRunId ?? null;
      const existing = fresh.some((m) => m.role === "user")
        ? yield* threadMessages(follow.threadId)
        : [];
      const composerSent = existing.filter(
        (m) => m.role === "user" && !String(m.id).startsWith(`${PREFIX}:`),
      );
      const events = fresh.flatMap((message) => {
        follow.written.add(message.uuid);
        if (
          message.role === "user" &&
          composerSent.some(
            (sent) =>
              isComposerEcho(message.text, sent.text) &&
              Math.abs(DateTime.toEpochMillis(sent.createdAt) - Date.parse(message.createdAt)) <
                15 * 60_000,
          )
        ) {
          return [];
        }
        return messageEvents(follow.threadId, sessionId, message, runId);
      });
      if (events.length > 0) yield* engine.writeEvents({ events });
    });

  const startFollowing = (session: ClaudeLiveSession) =>
    Effect.gen(function* () {
      const threadId = liveThreadId(session.sessionId);
      const path = transcriptPath(session);
      const size = path === null ? 0 : NodeFS.statSync(path).size;
      const from = Math.max(0, size - FIRST_READ_BYTES);
      const chunk = path === null ? "" : readRange(path, from, size);
      // A read from the middle of the file starts mid-record; the first line is dropped.
      const lines = splitTranscriptChunk(chunk).lines.slice(from > 0 ? 1 : 0);
      const history = lines
        .flatMap((line) => parseLiveTranscriptLine(line) ?? [])
        .slice(-FIRST_MESSAGES);
      const shell = yield* engine.threadShell(threadId);
      if (shell === null) {
        const firstUser = history.find((m) => m.role === "user")?.text.split("\n")[0];
        yield* createThread(
          session,
          threadId,
          (session.name ?? firstUser ?? "Live session").slice(0, 80),
        );
        if ((yield* engine.threadShell(threadId)) === null) {
          owned.add(session.sessionId); // another thread holds this native session
          return;
        }
      }
      const known = new Set(
        (yield* threadMessages(threadId)).flatMap((m) => {
          const id = String(m.id);
          const at = id.lastIndexOf(":");
          return id.startsWith(`${PREFIX}:`) ? [id.slice(at + 1)] : [];
        }),
      );
      const follow: Follow = { threadId, path, offset: size, rest: "", written: known };
      follows.set(session.sessionId, follow);
      // What the thread lacks from the transcript's tail: all of it the first time, and after a
      // restart whatever arrived while the server was down.
      yield* writeMessages(follow, session.sessionId, history);
    });

  const step = (session: ClaudeLiveSession, follow: Follow) =>
    Effect.gen(function* () {
      follow.path ??= transcriptPath(session);
      if (follow.path === null) return;
      const size = NodeFS.statSync(follow.path).size;
      if (size < follow.offset) {
        follow.offset = 0; // rewritten: read it again; uuids keep it idempotent
        follow.rest = "";
      }
      if (size === follow.offset) return;
      const to = Math.min(size, follow.offset + STEP_BYTES);
      const { lines, rest } = splitTranscriptChunk(
        follow.rest + readRange(follow.path, follow.offset, to),
      );
      follow.offset = to;
      follow.rest = rest;
      yield* writeMessages(
        follow,
        session.sessionId,
        lines.flatMap((line) => parseLiveTranscriptLine(line) ?? []),
      );
    });

  const tick = Effect.gen(function* () {
    const live = yield* readClaudeLiveSessions({ account: null });
    const fresh = live.filter((s) => !follows.has(s.sessionId) && !owned.has(s.sessionId));
    if (fresh.length > 0) {
      // A session upstream's importer already turned into a thread is that thread's.
      const shells = yield* engine.threadShells;
      for (const session of fresh) {
        if (
          shells.some(
            (t) =>
              String(t.id).startsWith("import:") && String(t.id).endsWith(`:${session.sessionId}`),
          )
        ) {
          owned.add(session.sessionId);
        }
      }
    }
    yield* Effect.forEach(
      live.filter((s) => !owned.has(s.sessionId)),
      (session) => {
        const follow = follows.get(session.sessionId);
        return (follow === undefined ? startFollowing(session) : step(session, follow)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Baton live threads: a session could not be mirrored", {
              sessionId: session.sessionId,
              cause,
            }).pipe(
              // Start over from the thread's own state next tick rather than guess.
              Effect.tap(() => Effect.sync(() => follows.delete(session.sessionId))),
            ),
          ),
        );
      },
      { discard: true },
    );
  });

  if (!liveThreadsEnabled()) return;
  yield* ensureProviderInstance;
  yield* tick.pipe(
    Effect.catchCause((cause) => Effect.logWarning("Baton live threads: tick failed", cause)),
    Effect.repeat(Schedule.spaced(TICK)),
    Effect.forkScoped,
  );
});

export const layer = Layer.effectDiscard(make);
