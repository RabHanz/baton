// @effect-diagnostics nodeBuiltinImport:off
/**
 * The Memory tab's state and actions (D150): what the server holds, what he is looking at, and what
 * each button does. The window only draws `controls()` and reports clicks to `act`. When the server
 * does not answer, his plain notes folder is shown as before, so the tab is never empty by accident.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { MemoryItem } from "@t3tools/baton-shared/memory";

import type { HomeControl } from "../home/batonHome.ts";
import type { MemoryCall } from "./memoryClient.ts";
import type { MemorySync } from "./memorySync.ts";
import { memoryControls, memoryIdOf } from "./memoryRows.ts";
import { noteControls } from "./noteRows.ts";
import type { NotesStore } from "./memoryNotes.ts";

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : "That did not work.";

export const createMemoryTab = (input: {
  readonly call: MemoryCall;
  readonly sync: MemorySync;
  readonly notes: NotesStore;
  readonly stateDir: string;
  readonly refresh: () => void;
  /** Show a file he can open. */
  readonly reveal: (path: string) => void;
}) => {
  let items: ReadonlyArray<MemoryItem> | null = null;
  let usedIds: ReadonlySet<string> = new Set();
  let query = "";
  let filter = "all";
  let usedOnly = false;
  let status = "";
  let loading = false;
  let pullOn = false;

  const load = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    try {
      const listed = (await input.call("list", {
        includeSuperseded: true,
        includeProposed: true,
        limit: 2_000,
      })) as { items?: ReadonlyArray<MemoryItem> } | null;
      items = listed?.items ?? [];
      const used = (await input.call("used", {}).catch(() => null)) as {
        items?: ReadonlyArray<MemoryItem>;
      } | null;
      usedIds = new Set((used?.items ?? []).map((i) => i.id));
      pullOn = ((await input.call("pull", { action: "status" }).catch(() => null)) as { enabled?: boolean } | null)?.enabled === true;
    } catch {
      items = null;
    } finally {
      loading = false;
      input.refresh();
    }
  };

  /** Runs one server call, says how it went, and draws the new state. */
  const run = async (op: string, args: Record<string, unknown>, done: string): Promise<void> => {
    try {
      await input.call(op, args);
      status = done;
    } catch (error) {
      status = reason(error);
    }
    await load();
  };

  const act = (id: string, value: string | boolean | null): boolean => {
    const text = typeof value === "string" ? value : "";
    let target: string | null;
    if (id === "m.query") {
      query = text;
      input.refresh();
    } else if (id === "m.kind") {
      filter = text === "" ? "all" : text;
      input.refresh();
    } else if (id === "m.used") {
      usedOnly = value === true;
      input.refresh();
    } else if (id === "m.export") {
      void input
        .call("export", {})
        .then((out) => {
          const file = NodePath.join(input.stateDir, "memory-export.md");
          NodeFS.writeFileSync(file, (out as { markdown?: string }).markdown ?? "");
          status = `Saved to ${file}`;
          input.reveal(file);
        })
        .catch((error: unknown) => void (status = reason(error)))
        .finally(input.refresh);
    } else if (id === "m.import") {
      if (text.trim() === "") return true;
      void input
        .call("import", { folder: text.trim() })
        .then((out) => {
          const r = out as { files: number; added: number; refused: number; unchanged: number };
          status = `Read ${r.files} files: ${r.added} added, ${r.unchanged} unchanged, ${r.refused} not kept.`;
        })
        .catch((error: unknown) => void (status = reason(error)))
        .then(load);
    } else if (id === "m.syncOn") {
      input.sync.setEnabled(value === true);
      status = value === true ? "Sync is on." : "Sync is off.";
      input.refresh();
    } else if (id === "m.pullOn") {
      void run("pull", { action: value === true ? "enable" : "disable" }, value === true ? "Pulling learnings daily; they wait for your yes." : "Not pulling learnings.");
    } else if (id === "m.pull") {
      void input
        .call("pull", { action: "run" })
        .then((out) => void (status = (out as { message: string }).message))
        .catch((e: unknown) => void (status = reason(e)))
        .then(load);
    } else if (id === "m.sync") {
      void input.sync
        .run()
        .then((line) => void (status = line))
        .then(load);
    } else if ((target = memoryIdOf(id, "m.edit")) !== null) {
      void run("edit", { id: target, text }, "Saved.");
    } else if ((target = memoryIdOf(id, "m.pin")) !== null) {
      void run("pin", { id: target, pinned: value === true }, value === true ? "Pinned." : "Unpinned.");
    } else if ((target = memoryIdOf(id, "m.forget")) !== null) {
      void run("forget", { id: target }, "Forgotten.");
    } else if ((target = memoryIdOf(id, "m.accept")) !== null) {
      void run("accept", { id: target }, "Kept.");
    } else return false;
    return true;
  };

  return {
    /** Opening the tab reads the server; it is read again after every change. */
    load,
    act,
    controls: (): ReadonlyArray<HomeControl> =>
      items === null
        ? noteControls(input.notes.list())
        : memoryControls({
            items,
            query,
            filter,
            usedIds,
            usedOnly,
            syncOn: input.sync.enabled(),
            pullOn,
            status,
          }),
  };
};

export type MemoryTab = ReturnType<typeof createMemoryTab>;
