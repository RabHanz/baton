import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/** Coding agent home directories the scanner knows how to read. */
export const AgentSessionSource = Schema.Literals(["claudeAgent", "codex"]);
export type AgentSessionSource = typeof AgentSessionSource.Type;

/** File identity saved with an imported session so bounded retries can skip unchanged history. */
export const AgentSessionImportSource = Schema.Struct({
  provider: AgentSessionSource,
  providerInstanceId: ProviderInstanceId,
  providerSessionId: TrimmedNonEmptyString,
  filePath: TrimmedNonEmptyString,
  size: NonNegativeInt,
  mtimeMs: Schema.NullOr(Schema.Number),
  device: Schema.Number,
  inode: Schema.NullOr(Schema.Number),
  birthtimeMs: Schema.NullOr(Schema.Number),
});
export type AgentSessionImportSource = typeof AgentSessionImportSource.Type;

/** Imported message ids retain their origin after event metadata is projected into SQLite. */
export function isImportedAgentSessionMessageId(messageId: string): boolean {
  return messageId.startsWith("import:");
}

/**
 * The thread id an imported conversation takes. Derived from the session rather
 * than generated, so importing the same transcript twice lands on the same
 * thread and a listing can say which conversations are already here.
 */
export function importedAgentSessionThreadId(source: {
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerSessionId: string;
}): ThreadId {
  return ThreadId.make(`import:${source.providerInstanceId}:${source.providerSessionId}`);
}

/**
 * Empty for now. Kept as a struct so future scan options (source filters,
 * explicit roots) can be added without a new method.
 */
export const AgentSessionScanInput = Schema.Struct({});
export type AgentSessionScanInput = typeof AgentSessionScanInput.Type;

/**
 * A directory that at least one agent CLI has run in, suitable for import as a
 * T3 Code project. `alreadyImported` marks candidates that already have an
 * active project rooted at the same path.
 */
/**
 * Git identity of a candidate directory, read from `.git/config` without
 * spawning git. `remoteKey` is the normalized origin URL, shared by every
 * clone of the same repository so the client can group them. `repository`
 * is the GitHub `owner/name` when the origin is on GitHub.
 */
export const AgentSessionProjectGit = Schema.Struct({
  remoteKey: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
});
export type AgentSessionProjectGit = typeof AgentSessionProjectGit.Type;

export const AgentSessionProjectCandidate = Schema.Struct({
  path: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  projectId: Schema.optional(ProjectId),
  sources: Schema.Array(AgentSessionSource),
  threadCount: NonNegativeInt,
  lastActiveAt: Schema.NullOr(IsoDateTime),
  alreadyImported: Schema.Boolean,
  /**
   * `null` when the directory is not the root of a git repository. Missing on
   * servers that predate the git scan, where the client cannot tell repositories
   * from plain folders and should treat every candidate as a standalone project.
   */
  git: Schema.optionalKey(Schema.NullOr(AgentSessionProjectGit)),
});
export type AgentSessionProjectCandidate = typeof AgentSessionProjectCandidate.Type;

export const AgentSessionScanResult = Schema.Struct({
  candidates: Schema.Array(AgentSessionProjectCandidate),
  scannedAt: IsoDateTime,
  truncated: Schema.optional(Schema.Boolean),
});
export type AgentSessionScanResult = typeof AgentSessionScanResult.Type;

export const AgentSessionImportInput = Schema.Struct({
  projectId: ProjectId,
  expectedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
});
export type AgentSessionImportInput = typeof AgentSessionImportInput.Type;

export class AgentSessionImportProjectNotFoundError extends Schema.TaggedError<AgentSessionImportProjectNotFoundError>()(
  "AgentSessionImportProjectNotFoundError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project '${this.projectId}' does not exist.`;
  }
}

export class AgentSessionImportProjectChangedError extends Schema.TaggedError<AgentSessionImportProjectChangedError>()(
  "AgentSessionImportProjectChangedError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project '${this.projectId}' changed directories. Scan for projects again before importing history.`;
  }
}

export const AgentSessionImportResult = Schema.Struct({
  importedCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
});
export type AgentSessionImportResult = typeof AgentSessionImportResult.Type;

/**
 * One conversation a coding agent left on disk, offered for import by name
 * rather than by the directory it ran in. The wizard's project-shaped scan
 * answers "which folders have history"; this answers "which conversation was
 * that", which is the question somebody looking for a session they remember is
 * actually asking.
 *
 * `threadId` is the id the imported thread takes, derived from the provider
 * session, so a client can open the conversation whether it imports it now or
 * imported it last week.
 */
export const AgentSessionThreadSummary = Schema.Struct({
  provider: AgentSessionSource,
  providerInstanceId: ProviderInstanceId,
  providerSessionId: TrimmedNonEmptyString,
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  /** First user message, trimmed — the line that says which conversation this is. */
  preview: Schema.String,
  /** Directory the session ran in, as the transcript recorded it. */
  workspaceRoot: TrimmedNonEmptyString,
  /** Set when a project already exists at that directory on this server. */
  projectId: Schema.optional(ProjectId),
  model: Schema.NullOr(Schema.String),
  messageCount: NonNegativeInt,
  sizeBytes: NonNegativeInt,
  startedAt: IsoDateTime,
  lastActiveAt: IsoDateTime,
  alreadyImported: Schema.Boolean,
  /**
   * The transcript was written to minutes ago, so that session may still be
   * running. Resuming it would put a second writer on one file, and that file
   * is the only record of the conversation — so the listing says so and waits
   * rather than offering it.
   */
  stillWriting: Schema.Boolean,
});
export type AgentSessionThreadSummary = typeof AgentSessionThreadSummary.Type;

/** `workspaceRoot` narrows the listing to one project's directory. */
export const AgentSessionThreadsInput = Schema.Struct({
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
});
export type AgentSessionThreadsInput = typeof AgentSessionThreadsInput.Type;

export const AgentSessionThreadsResult = Schema.Struct({
  threads: Schema.Array(AgentSessionThreadSummary),
  scannedAt: IsoDateTime,
  /** A budget ran out before every transcript was read. */
  truncated: Schema.optional(Schema.Boolean),
});
export type AgentSessionThreadsResult = typeof AgentSessionThreadsResult.Type;

/**
 * Import exactly one conversation into an existing project. The project-wide
 * import takes everything recent in a directory, which is right for onboarding
 * and wrong for "resume that one" — picking a single session must not drag a
 * live transcript from the same folder in beside it.
 */
export const AgentSessionImportThreadInput = Schema.Struct({
  projectId: ProjectId,
  provider: AgentSessionSource,
  providerInstanceId: ProviderInstanceId,
  providerSessionId: TrimmedNonEmptyString,
  expectedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
});
export type AgentSessionImportThreadInput = typeof AgentSessionImportThreadInput.Type;

export const AgentSessionImportThreadResult = Schema.Struct({
  threadId: ThreadId,
  /** False when the thread was already imported, which is not a failure. */
  imported: Schema.Boolean,
});
export type AgentSessionImportThreadResult = typeof AgentSessionImportThreadResult.Type;

export class AgentSessionImportThreadError extends Schema.TaggedError<AgentSessionImportThreadError>()(
  "AgentSessionImportThreadError",
  {
    providerSessionId: TrimmedNonEmptyString,
    reason: Schema.Literals(["not-found", "unresumable", "changed", "still-writing"]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-found":
        return `Conversation '${this.providerSessionId}' is no longer on disk in this project. Scan again.`;
      case "unresumable":
        return `Conversation '${this.providerSessionId}' has no session id its CLI can resume.`;
      case "changed":
        return `Conversation '${this.providerSessionId}' changed while it was importing.`;
      case "still-writing":
        return `Conversation '${this.providerSessionId}' was written to in the last few minutes, so it is probably still running. Importing it now would put a second writer on the only file that holds it — close that session and try again.`;
    }
  }
}

export class AgentSessionScanError extends Schema.TaggedError<AgentSessionScanError>()(
  "AgentSessionScanError",
  {
    // `import-thread` reaches only the single-conversation import, which no
    // client that predates it can call.
    operation: Schema.Literals(["read-settings", "read-projects", "import-thread"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to scan agent sessions during ${this.operation}.`;
  }
}
