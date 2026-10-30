// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { ensureModel } from "./voiceModels.ts";

const bytes = Buffer.from("parakeet");
const model = (sha256: string) => ({
  file: "m.gguf",
  url: "https://example.invalid/m.gguf",
  size: bytes.length,
  sha256,
});
const good = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const fetchImpl = (async () => new Response(bytes)) as unknown as typeof fetch;
const tempDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-model-"));

describe("ensureModel", () => {
  it("publishes the file only after the hash matches", async () => {
    const dir = tempDir();
    const path = await ensureModel({ dir, model: model(good), onProgress: () => {}, fetchImpl });
    expect(NodeFS.readFileSync(path)).toEqual(bytes);
  });

  it("leaves nothing behind on a bad hash", async () => {
    const dir = tempDir();
    await expect(
      ensureModel({ dir, model: model("0".repeat(64)), onProgress: () => {}, fetchImpl }),
    ).rejects.toThrow("checksum");
    expect(NodeFS.readdirSync(dir)).toEqual([]);
  });

  it("does not download what is already there", async () => {
    const dir = tempDir();
    NodeFS.writeFileSync(NodePath.join(dir, "m.gguf"), bytes);
    const never = (async () => {
      throw new Error("no network");
    }) as unknown as typeof fetch;
    await expect(
      ensureModel({ dir, model: model(good), onProgress: () => {}, fetchImpl: never }),
    ).resolves.toContain("m.gguf");
  });
});
