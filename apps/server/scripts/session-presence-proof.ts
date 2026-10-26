/**
 * Run the session listing against this machine's real transcripts and the real
 * project rows, and print what presence would show.
 *
 * The unit tests prove the containment rule on fixtures. This proves it on the
 * thing the rule was written for: a box with 7,071 Claude transcripts, one
 * project, and 4,013 sessions that belonged to no project before tonight.
 *
 *   node apps/server/scripts/session-presence-proof.ts [workspaceRoot]
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DatabaseSync } from "node:sqlite";

import * as ServerConfig from "../src/config.ts";
import * as ProjectionSnapshotQuery from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import * as AgentSessionScanner from "../src/project/AgentSessionScanner.ts";
import * as ServerSettings from "../src/serverSettings.ts";

const USERDATA = `${process.env["HOME"]}/.t3/userdata/state.sqlite`;

/** The live project rows, read straight out of the running server's database. */
const readProjects = () => {
  const db = new DatabaseSync(USERDATA, { readOnly: true });
  try {
    return db
      .prepare(
        "select project_id, title, workspace_root from projection_projects where deleted_at is null",
      )
      .all()
      .map((row) => ({
        id: ProjectId.make(String(row["project_id"])),
        title: String(row["title"]),
        workspaceRoot: String(row["workspace_root"]),
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
  } finally {
    db.close();
  }
};

const readThreadIds = () => {
  const db = new DatabaseSync(USERDATA, { readOnly: true });
  try {
    return db
      .prepare("select thread_id from projection_threads where deleted_at is null")
      .all()
      .map((row) => ({ id: String(row["thread_id"]) }));
  } finally {
    db.close();
  }
};

const snapshotLayer = Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
  getCommandReadModel: () => Effect.die("unused"),
  getUserInputActivity: () => Effect.die("unused"),
  listActivitiesByKind: () => Effect.die("unused"),
  getSnapshot: () => Effect.die("unused"),
  getShellSnapshot: () =>
    Effect.sync(() => ({
      snapshotSequence: 0,
      projects: readProjects(),
      threads: readThreadIds(),
      updatedAt: new Date().toISOString(),
    })),
  getDeletedWorktreeThreads: () => Effect.die("unused"),
  getArchivedShellSnapshot: () => Effect.die("unused"),
  getSnapshotSequence: () => Effect.die("unused"),
  getCounts: () => Effect.die("unused"),
  getEventReplayStats: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
  getProjectShells: () => Effect.die("unused"),
  getProjectShellById: () => Effect.die("unused"),
  getImportedAgentSessionSources: () => Effect.succeed([]),
  getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
  getThreadCheckpointContext: () => Effect.die("unused"),
  getFullThreadDiffContext: () => Effect.die("unused"),
  getThreadShellById: () => Effect.die("unused"),
  getThreadRuntimeContext: () => Effect.die("unused"),
  getTurnStartMessage: () => Effect.die("unused"),
  getThreadDetailById: () => Effect.die("unused"),
  getThreadDetailSnapshot: () => Effect.die("unused"),
  searchThreads: () => Effect.die("unused"),
} as unknown as ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]);

const program = Effect.gen(function* () {
  const scanner = yield* AgentSessionScanner.AgentSessionScanner;
  const workspaceRoot = process.argv[2];
  const listed = yield* scanner.recentThreadSummaries(
    workspaceRoot === undefined ? {} : { workspaceRoot },
  );

  const nested = listed.threads.filter((thread) => thread.nested === true);
  const owned = listed.threads.filter((thread) => thread.projectId !== undefined);
  const running = listed.threads.filter((thread) => thread.stillWriting);
  console.log(
    JSON.stringify(
      {
        scope: workspaceRoot ?? "every project on this machine",
        listed: listed.threads.length,
        withAProject: owned.length,
        nested: nested.length,
        running: running.length,
        truncated: listed.truncated ?? false,
      },
      null,
      2,
    ),
  );
  for (const thread of listed.threads.slice(0, 8)) {
    console.log(
      [
        thread.nested === true ? "nested" : "root  ",
        thread.stillWriting ? "running" : thread.alreadyImported ? "here   " : "on-disk",
        (thread.projectId ?? "no project").slice(0, 12),
        thread.sessionRoot ?? thread.workspaceRoot,
        thread.title.slice(0, 40),
      ].join("  "),
    );
  }
});

const layer = AgentSessionScanner.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      ServerSettings.layerTest({
        providers: {
          claudeAgent: { homePath: `${process.env["HOME"]}/.claude` },
          codex: { homePath: `${process.env["HOME"]}/.codex` },
        },
      }),
      ServerConfig.layerTest(`${process.env["HOME"]}/.claude`, {
        prefix: "t3code-presence-proof-",
      }),
      snapshotLayer,
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer)))).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
