/**
 * Baton's window asks this sidebar for the session catalog, one environment at a time, and the sidebar answers with
 * the same commands a click would use. Pure over its commands, so it is tested without a connection.
 */
import type {
  BatonCatalogCreateInput,
  BatonCatalogCreateResult,
  BatonCatalogFoldersInput,
  BatonCatalogFoldersResult,
  BatonCatalogListInput,
  BatonCatalogListResult,
  BatonCatalogResumeInput,
  BatonCatalogResumeResult,
  BatonSessionRequest,
} from "@t3tools/baton-contracts";

type Answer<T> = { readonly _tag: string; readonly value?: T };
type Command<I, O> = (args: { environmentId: never; input: I }) => Promise<Answer<O>>;

export interface CatalogCommands {
  readonly list: Command<typeof BatonCatalogListInput.Type, typeof BatonCatalogListResult.Type>;
  readonly resume: Command<
    typeof BatonCatalogResumeInput.Type,
    typeof BatonCatalogResumeResult.Type
  >;
  readonly create: Command<
    typeof BatonCatalogCreateInput.Type,
    typeof BatonCatalogCreateResult.Type
  >;
  readonly folders: Command<
    typeof BatonCatalogFoldersInput.Type,
    typeof BatonCatalogFoldersResult.Type
  >;
}

type Reply = { readonly ok: boolean; readonly detail: string };
const NO = (detail: string): Reply => ({ ok: false, detail });
const env = (id: string) => id as never;

/** The catalog requests of Baton's window; null when the request is not one of them. */
export const answerCatalogRequest = async (
  request: BatonSessionRequest,
  deps: {
    readonly commands: CatalogCommands;
    readonly environmentIds: ReadonlyArray<string>;
    readonly label: (environmentId: string) => string;
  },
): Promise<Reply | null> => {
  const { commands } = deps;
  if (request.kind === "catalogList") {
    const rows = await Promise.all(
      deps.environmentIds.map(async (environmentId) => {
        const answer = await commands
          .list({ environmentId: env(environmentId), input: { query: request.query, limit: 200 } })
          .catch(() => null);
        if (answer === null || answer._tag !== "Success" || answer.value === undefined) return [];
        return answer.value.sessions.map((row) => ({
          ...row,
          environmentId,
          machine: deps.label(environmentId),
        }));
      }),
    );
    return { ok: true, detail: JSON.stringify(rows.flat()) };
  }
  if (request.kind === "catalogResume") {
    const answer = await commands.resume({
      environmentId: env(request.environmentId),
      input: {
        sessionId: request.sessionId,
        ...(request.cwd === null ? {} : { cwd: request.cwd }),
      },
    });
    if (answer._tag !== "Success" || answer.value === undefined)
      return NO("That session could not be resumed.");
    return { ok: answer.value.state !== "failed", detail: JSON.stringify(answer.value) };
  }
  if (request.kind === "catalogCreate") {
    const answer = await commands.create({
      environmentId: env(request.environmentId),
      input: { cwd: request.cwd, agent: "claude" },
    });
    if (answer._tag !== "Success" || answer.value === undefined)
      return NO("That session could not be started.");
    return { ok: answer.value.state !== "failed", detail: JSON.stringify(answer.value) };
  }
  if (request.kind === "catalogFolders") {
    const answer = await commands
      .folders({ environmentId: env(request.environmentId), input: {} })
      .catch(() => null);
    const folders = answer?._tag === "Success" ? (answer.value?.folders ?? []) : [];
    return { ok: true, detail: JSON.stringify(folders.map((f) => f.cwd)) };
  }
  return null;
};
