import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  type AgentSessionThreadSummary,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { CheckIcon, FolderIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { newProjectId } from "../../lib/utils";
import { cn } from "../../lib/utils";
import { deriveProviderEntriesByEnvironment } from "../../providerInstances";
import { agentSessionImportThread, agentSessionThreads } from "../../state/agentSessions";
import { readProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { formatEnvironmentQueryError } from "../../state/query";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  canImportConversation,
  conversationUnavailableReason,
  formatConversationSize,
  workspaceRootTitle,
} from "./ImportConversationsDialog.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";

const PROVIDER_LABELS = { claudeAgent: "Claude Code", codex: "Codex" } as const;

/**
 * The account that ran a conversation, named the way the fleet rows name it:
 * the instance the user configured, with its address behind a click.
 */
function useAccountLabels(environmentId: EnvironmentId) {
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  return useMemo(() => {
    const entries = deriveProviderEntriesByEnvironment(
      [...serverConfigs].map(([id, config]) => [id, config.providers] as const),
    );
    return entries.get(environmentId) ?? new Map();
  }, [environmentId, serverConfigs]);
}

/**
 * Pick a conversation Claude Code or Codex already had, and carry on with it.
 *
 * Upstream can only do this during the first-run wizard, which every returning
 * user has already passed — so the sessions are on disk, the scan finds them,
 * the importer resumes them, and none of it is reachable. This is the same
 * machinery with a door on it, in Settings next to the machine it reads and in
 * the project it belongs to.
 */
export function ImportConversationsDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
  workspaceRoot,
  onOpenThread,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  /** Set from a project, which narrows the list to that project's directory. */
  readonly workspaceRoot?: string;
  readonly onOpenThread: (environmentId: EnvironmentId, threadId: string) => void;
}) {
  const listAtom = useMemo(
    () =>
      agentSessionThreads({
        environmentId,
        input: workspaceRoot === undefined ? {} : { workspaceRoot },
      }),
    [environmentId, workspaceRoot],
  );
  const result = useAtomValue(listAtom);
  const listing = Option.getOrNull(AsyncResult.value(result));
  const isPending = result.waiting || result._tag === "Initial";
  const error = result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null;
  const accounts = useAccountLabels(environmentId);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importThread = useAtomCommand(agentSessionImportThread, { reportFailure: false });

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const threads = listing?.threads ?? [];
  const chosen = threads.filter((thread) => selected.has(thread.threadId));

  const toggle = (thread: AgentSessionThreadSummary) => {
    setImportError("");
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(thread.threadId)) next.delete(thread.threadId);
      else next.add(thread.threadId);
      return next;
    });
  };

  /** The project the conversation ran in, created here when it has none yet. */
  const resolveProjectId = async (thread: AgentSessionThreadSummary): Promise<ProjectId | null> => {
    if (thread.projectId !== undefined) return thread.projectId;
    const existing = readProjects().find(
      (project) =>
        project.environmentId === environmentId && project.workspaceRoot === thread.workspaceRoot,
    );
    if (existing) return existing.id;
    const projectId = newProjectId();
    const created = await createProject({
      environmentId,
      input: {
        projectId,
        commandId: CommandId.make(`import-conversations:project:${projectId}`),
        title: workspaceRootTitle(thread.workspaceRoot),
        workspaceRoot: thread.workspaceRoot,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    if (created._tag !== "Success") {
      if (!isAtomCommandInterrupted(created)) {
        const failure = squashAtomCommandFailure(created);
        setImportError(
          failure instanceof Error ? failure.message : "Could not add that project folder.",
        );
      }
      return null;
    }
    return projectId;
  };

  const runImport = async () => {
    if (isImporting || chosen.length === 0) return;
    setIsImporting(true);
    setImportError("");
    let landing: { readonly threadId: string } | null = null;
    let failures = 0;
    for (const thread of chosen) {
      const projectId = await resolveProjectId(thread);
      if (projectId === null) {
        failures += 1;
        continue;
      }
      const imported = await importThread({
        environmentId,
        input: {
          projectId,
          provider: thread.provider,
          providerInstanceId: thread.providerInstanceId,
          providerSessionId: thread.providerSessionId,
          expectedWorkspaceRoot: thread.workspaceRoot,
        },
      });
      if (imported._tag !== "Success") {
        if (!isAtomCommandInterrupted(imported)) {
          failures += 1;
          const failure = squashAtomCommandFailure(imported);
          setImportError(
            failure instanceof Error ? failure.message : "Could not import that conversation.",
          );
        }
        continue;
      }
      landing ??= { threadId: imported.value.threadId };
    }
    setIsImporting(false);
    if (landing === null) {
      if (failures === 0) setImportError("Could not import that conversation.");
      return;
    }
    onOpenChange(false);
    onOpenThread(environmentId, landing.threadId);
  };

  const title = workspaceRoot === undefined ? "Import conversations" : "Import conversations here";
  const description =
    workspaceRoot === undefined
      ? `Claude Code and Codex sessions on ${environmentLabel}, newest first. Importing one opens it here and resumes it where it left off.`
      : `Claude Code and Codex sessions from ${workspaceRoot}, newest first.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-h-[85dvh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {isPending && listing === null ? (
            <div
              data-testid="import-conversations-loading"
              className="flex flex-col items-center gap-3 py-10"
            >
              <Spinner className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Looking for conversations…</p>
            </div>
          ) : error !== null ? (
            <p className="py-8 text-center text-sm text-destructive">
              Could not read conversations. {error}
            </p>
          ) : threads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No Claude Code or Codex conversations from the last 30 days on {environmentLabel}.
            </p>
          ) : (
            <div data-testid="import-conversations-list" className="flex flex-col gap-1">
              {threads.map((thread) => {
                const account = accounts.get(thread.providerInstanceId);
                const accountLabel =
                  account?.displayName?.trim() || PROVIDER_LABELS[thread.provider];
                const isSelected = selected.has(thread.threadId);
                // Two writers on one transcript would damage the only record of
                // the conversation, so that row says so instead of offering it.
                const unavailable = conversationUnavailableReason(thread);
                return (
                  <button
                    key={thread.threadId}
                    type="button"
                    disabled={!canImportConversation(thread) || isImporting}
                    aria-pressed={isSelected}
                    onClick={() => toggle(thread)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md border border-transparent px-3 py-2 text-left",
                      "hover:bg-accent/60 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
                      isSelected && "border-border bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-border",
                        isSelected && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {isSelected ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {thread.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelativeTimeLabel(thread.lastActiveAt)}
                        </span>
                      </span>
                      {thread.preview.length > 0 ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {thread.preview}
                        </span>
                      ) : null}
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/80">
                        <FolderIcon aria-hidden className="size-3 shrink-0" />
                        <span className="min-w-0 truncate">{thread.workspaceRoot}</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">{accountLabel}</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">{thread.messageCount} messages</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">{formatConversationSize(thread.sizeBytes)}</span>
                        {unavailable !== null ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="shrink-0">
                              {unavailable === "already-here"
                                ? "already here"
                                : "still running — wait for it to stop"}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
              {listing?.truncated === true ? (
                <p
                  data-testid="import-conversations-truncated"
                  className="px-3 pt-2 text-xs text-muted-foreground"
                >
                  Scan limit reached. Some conversations may be missing.
                </p>
              ) : null}
            </div>
          )}
          {importError ? (
            <p className="pt-3 text-sm text-destructive" role="alert">
              {importError}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            disabled={isImporting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={chosen.length === 0 || isImporting}
            onClick={() => void runImport()}
          >
            {isImporting ? (
              <>
                <Spinner className="size-3.5" />
                Importing…
              </>
            ) : (
              `Import${chosen.length > 1 ? ` ${chosen.length}` : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Kept beside the dialog so every entry point labels the action the same way. */
export const IMPORT_CONVERSATIONS_LABEL = "Import Claude Code / Codex conversations…";
