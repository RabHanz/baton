// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { createCloudKeys, type KeyProtection } from "./cloudKeys.ts";

const KEY = "sk-live-abcdef123456";
/** Stands in for safeStorage: reversible, and never the plain text. */
const os: KeyProtection = {
  protect: (plain) => `wrapped:${Buffer.from(plain).toString("base64")}`,
  unprotect: (wrapped) => {
    if (!wrapped.startsWith("wrapped:")) throw new Error("cannot decrypt");
    return Buffer.from(wrapped.slice(8), "base64").toString();
  },
};

const setup = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cloud-keys-"));
  const file = NodePath.join(dir, "voice", "cloud-keys.json");
  return {
    dir,
    file,
    [Symbol.dispose]: () => NodeFS.rmSync(dir, { recursive: true, force: true }),
  };
};

describe("his cloud speech keys", () => {
  it("keeps a key wrapped by the OS, never in the clear, one per provider", () => {
    using t = setup();
    const keys = createCloudKeys(t.file, () => os);
    keys.set("openai", `  ${KEY}  `);
    expect(keys.get("openai")).toBe(KEY);
    expect(keys.has("gemini")).toBe(false);
    expect(NodeFS.readFileSync(t.file, "utf8")).not.toContain(KEY);
    keys.clear("openai");
    expect(keys.get("openai")).toBeNull();
  });

  it("refuses to keep a key where the OS cannot encrypt it (Linux basic_text)", () => {
    using t = setup();
    const keys = createCloudKeys(t.file, () => null);
    expect(() => keys.set("openai", KEY)).toThrow(/cannot encrypt/);
    expect(NodeFS.existsSync(t.file)).toBe(false);
  });

  it("treats a key that will not unwrap, or a damaged file, as no key", () => {
    using t = setup();
    NodeFS.mkdirSync(NodePath.dirname(t.file), { recursive: true });
    NodeFS.writeFileSync(t.file, JSON.stringify({ openai: "from another computer" }));
    expect(createCloudKeys(t.file, () => os).get("openai")).toBeNull();
    NodeFS.writeFileSync(t.file, "{not json");
    expect(createCloudKeys(t.file, () => os).get("openai")).toBeNull();
  });
});
