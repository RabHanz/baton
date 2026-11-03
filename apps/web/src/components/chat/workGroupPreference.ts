/**
 * "Keep work groups expanded" and the thread header's Expand all / Collapse all work: one small store so the header menu
 * and the timeline agree without threading props through the chat view. The setting is per browser and defaults on.
 */
import { useSyncExternalStore } from "react";

const KEY = "tessaya.keepWorkExpanded";
const listeners = new Set<() => void>();
const read = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "false";
  } catch {
    return true;
  }
};
let keep = read();
export const setKeepWorkExpanded = (next: boolean) => {
  keep = next;
  try {
    globalThis.localStorage?.setItem(KEY, String(next));
  } catch {
    // private mode: the choice lasts until reload
  }
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getKeepWorkExpanded = (): boolean => keep;
export const useKeepWorkExpanded = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => keep,
    () => true,
  );

/** Expand all / Collapse all work: the timeline applies the latest command once. */
export interface WorkGroupCommand {
  readonly id: number;
  readonly mode: "expand" | "collapse";
}
let command: WorkGroupCommand = { id: 0, mode: "expand" };
export const issueWorkGroupCommand = (mode: WorkGroupCommand["mode"]) => {
  command = { id: command.id + 1, mode };
  for (const listener of listeners) listener();
};
export const useWorkGroupCommand = (): WorkGroupCommand =>
  useSyncExternalStore(
    subscribe,
    () => command,
    () => command,
  );
