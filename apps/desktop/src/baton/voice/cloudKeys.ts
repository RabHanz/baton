// @effect-diagnostics nodeBuiltinImport:off
/**
 * His cloud speech keys, one per provider, wrapped by the OS (Electron safeStorage) in voice/cloud-keys.json. Not the
 * vault: that locks after ten idle minutes, and dictation must not stop for a Windows Hello prompt mid-sentence. Never in
 * settings.json, never in a log; a key that will not unwrap counts as no key.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { CloudSttProvider } from "@t3tools/baton-shared/cloudStt";

/** Wraps and unwraps with the OS; null where that is not real encryption (Linux's basic_text). */
export interface KeyProtection {
  readonly protect: (plain: string) => string;
  readonly unprotect: (wrapped: string) => string;
}

export interface CloudKeys {
  readonly get: (provider: CloudSttProvider) => string | null;
  readonly has: (provider: CloudSttProvider) => boolean;
  /** Throws when this computer cannot encrypt it, so it is never kept in the clear. */
  readonly set: (provider: CloudSttProvider, key: string) => void;
  readonly clear: (provider: CloudSttProvider) => void;
}

export const createCloudKeys = (
  file: string,
  protection: () => KeyProtection | null,
): CloudKeys => {
  const read = (): Partial<Record<CloudSttProvider, string>> => {
    try {
      const parsed = JSON.parse(NodeFS.readFileSync(file, "utf8")) as unknown;
      return parsed !== null && typeof parsed === "object"
        ? (parsed as Partial<Record<CloudSttProvider, string>>)
        : {};
    } catch {
      return {};
    }
  };
  const write = (all: Partial<Record<CloudSttProvider, string>>) => {
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
  };
  const get = (provider: CloudSttProvider): string | null => {
    const wrapped = read()[provider];
    const os = protection();
    if (typeof wrapped !== "string" || os === null) return null;
    try {
      const key = os.unprotect(wrapped);
      return key === "" ? null : key;
    } catch {
      return null;
    }
  };
  return {
    get,
    has: (provider) => get(provider) !== null,
    set: (provider, key) => {
      const os = protection();
      if (os === null) {
        throw new Error(
          "This computer cannot encrypt the key, so it is not kept. Cloud recognition needs a key it can keep safely.",
        );
      }
      const trimmed = key.trim();
      if (trimmed === "") throw new Error("The key is empty.");
      write({ ...read(), [provider]: os.protect(trimmed) });
    },
    clear: (provider) => {
      const { [provider]: _gone, ...rest } = read();
      write(rest);
    },
  };
};
