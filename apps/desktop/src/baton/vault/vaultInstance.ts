// @effect-diagnostics nodeBuiltinImport:off
/** The one vault of this computer (D151): the window and the assistant share it. Electron-only, so not unit tested. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Electron from "electron";

import { createVault, type Vault } from "./vaultStore.ts";

const instances = new Map<
  string,
  { readonly vault: Vault; readonly audit: (line: string) => void; readonly auditFile: string }
>();

export const vaultFor = (stateDir: string) => {
  const held = instances.get(stateDir);
  if (held !== undefined) return held;
  const auditFile = NodePath.join(stateDir, "vault-audit.ndjson");
  const vault = createVault({
    file: NodePath.join(stateDir, "vault.json"),
    os: {
      wrap: (key) =>
        Electron.safeStorage.isEncryptionAvailable()
          ? Electron.safeStorage.encryptString(key.toString("base64")).toString("base64")
          : null,
      unwrap: (wrapped) => {
        try {
          return Buffer.from(
            Electron.safeStorage.decryptString(Buffer.from(wrapped, "base64")),
            "base64",
          );
        } catch {
          return null;
        }
      },
    },
    // A value Tessaya left on the clipboard goes with the lock.
    onLock: () => undefined,
  });
  Electron.app
    .whenReady()
    .then(() => {
      Electron.powerMonitor.on("lock-screen", () => vault.lock());
      Electron.powerMonitor.on("suspend", () => vault.lock());
    })
    .catch(() => undefined);
  const made = {
    vault,
    auditFile,
    audit: (line: string) => {
      NodeFS.mkdirSync(stateDir, { recursive: true });
      NodeFS.appendFileSync(auditFile, `${line}\n`, { mode: 0o600 });
    },
  };
  instances.set(stateDir, made);
  return made;
};
