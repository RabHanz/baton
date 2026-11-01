// @effect-diagnostics globalTimers:off
/**
 * Glue between upstream's updater state and Baton's window (D137). The state comes in, the rules in
 * `updateLogic.ts` decide, and the actions go back out to the updater through the functions given.
 */
import type { DesktopUpdateState } from "@t3tools/contracts";

import type { HomeControl } from "../home/batonHome.ts";
import { canInstallNow, isReady, shouldDownload, updateControls } from "./updateLogic.ts";

export interface BatonUpdates {
  readonly controls: () => ReadonlyArray<HomeControl>;
  readonly apply: (id: string) => void;
  /** An update is downloaded and waiting for his click, for the dot on the tray. */
  readonly ready: () => boolean;
  /** Choose what the tray's own entry should do, now or when idle. */
  readonly install: () => void;
}

const IDLE_POLL_MS = 5_000;

export const createBatonUpdater = (input: {
  readonly initial: DesktopUpdateState;
  readonly check: () => Promise<unknown>;
  readonly download: () => Promise<unknown>;
  readonly install: () => Promise<unknown>;
  readonly installOnQuit: () => void;
  readonly busy: () => { readonly voiceBusy: boolean; readonly assistantBusy: boolean };
  readonly onChange: () => void;
}): BatonUpdates & { readonly onState: (state: DesktopUpdateState) => void } => {
  let state = input.initial;
  let pending: ReturnType<typeof setInterval> | null = null;
  let announcedReady = false;

  const installWhenIdle = () => {
    if (canInstallNow(input.busy())) {
      void input.install();
      return;
    }
    if (pending !== null) return;
    pending = setInterval(() => {
      if (!canInstallNow(input.busy())) return;
      if (pending !== null) clearInterval(pending);
      pending = null;
      void input.install();
    }, IDLE_POLL_MS);
    pending.unref();
    input.onChange();
  };

  return {
    onState: (next) => {
      state = next;
      if (shouldDownload(next)) void input.download();
      // Downloaded, so quitting by hand installs it too. Never before there is a file to install.
      if (isReady(next) && !announcedReady) {
        announcedReady = true;
        input.installOnQuit();
      }
      input.onChange();
    },
    controls: () => updateControls(state, pending !== null),
    ready: () => isReady(state),
    install: installWhenIdle,
    apply: (id) => {
      if (id !== "u.act") return;
      if (isReady(state)) installWhenIdle();
      else if (state.status === "available" || (state.status === "error" && state.canRetry)) {
        void input.download();
      } else void input.check();
    },
  };
};
