// @effect-diagnostics nodeBuiltinImport:off
/**
 * "Start Tessaya when I sign in" is the registry's Run entry, which the installer and the switch both write
 * under the app's id (its AppUserModelId, passed in), so the switch reads that entry, not a copy of it in the settings file. Electron can
 * only read the entry under its own default name, so the one under the app's id is read from the registry.
 */
import * as NodeChildProcess from "node:child_process";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

interface LoginApi {
  readonly getLoginItemSettings: () => { readonly openAtLogin: boolean };
  readonly setLoginItemSettings: (settings: {
    readonly openAtLogin: boolean;
    readonly name?: string;
  }) => void;
}

/** Whether the Run entry `name` exists. Windows only; elsewhere there is none. */
export const runEntryExists = (name: string): boolean => {
  if (process.platform !== "win32") return false;
  try {
    NodeChildProcess.execFileSync("reg", ["query", RUN_KEY, "/v", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** On when the Run entry exists under the app's id or under Electron's default name. */
export const loginItemOn = (
  api: LoginApi,
  entry: string,
  exists: (name: string) => boolean = runEntryExists,
): boolean => {
  try {
    return exists(entry) || api.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
};

/** One entry, under the app's id, for the current exe; the default-named one is cleared so there is never two. */
export const setLoginItem = (api: LoginApi, entry: string, on: boolean): void => {
  api.setLoginItemSettings({ openAtLogin: false });
  api.setLoginItemSettings({ openAtLogin: on, name: entry });
};
