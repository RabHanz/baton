// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { ensureModel, modelPresent } from "./voiceModels.ts";

const bytes = Buffer.from("parakeet");
const model = (sha256: string) => ({
  file: "m.gguf",
  url: "https://example.invalid/m.gguf",
  size: bytes.length,
  sha256,
});
const good = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const fetchImpl = (async () => new Response(bytes)) as unknown as typeof fetch;
const instant = { attempts: 1, retryDelayMs: 0 };
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
      ensureModel({
        dir,
        model: model("0".repeat(64)),
        onProgress: () => {},
        fetchImpl,
        ...instant,
      }),
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

  it("replaces a right-sized file whose bytes are wrong", async () => {
    const dir = tempDir();
    NodeFS.writeFileSync(NodePath.join(dir, "m.gguf"), "x".repeat(bytes.length));
    const path = await ensureModel({ dir, model: model(good), onProgress: () => {}, fetchImpl });
    expect(NodeFS.readFileSync(path)).toEqual(bytes);
  });

  it("gives one download to two callers", async () => {
    const dir = tempDir();
    let calls = 0;
    const counted = (async () => {
      calls += 1;
      return new Response(bytes);
    }) as unknown as typeof fetch;
    const input = { dir, model: model(good), onProgress: () => {}, fetchImpl: counted };
    await Promise.all([ensureModel(input), ensureModel(input)]);
    expect(calls).toBe(1);
  });

  it("retries a failed download", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      return new Response(bytes);
    }) as unknown as typeof fetch;
    const dir = tempDir();
    await ensureModel({
      dir,
      model: model(good),
      onProgress: () => {},
      fetchImpl: flaky,
      attempts: 2,
      retryDelayMs: 0,
    });
    expect(calls).toBe(2);
  });

  it("gives up on a stalled download and leaves nothing behind", async () => {
    const stalled = (async () =>
      new Response(new ReadableStream({ start: () => {} }))) as unknown as typeof fetch;
    const dir = tempDir();
    await expect(
      ensureModel({
        dir,
        model: model(good),
        onProgress: () => {},
        fetchImpl: stalled,
        stallMs: 20,
        ...instant,
      }),
    ).rejects.toThrow("stalled");
    expect(NodeFS.readdirSync(dir)).toEqual([]);
  });

  it("names a model that is present only at its full size", () => {
    const dir = tempDir();
    expect(modelPresent(dir, model(good))).toBe(false);
    NodeFS.writeFileSync(NodePath.join(dir, "m.gguf"), bytes);
    expect(modelPresent(dir, model(good))).toBe(true);
  });
});
