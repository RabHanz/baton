// @effect-diagnostics nodeBuiltinImport:off
/**
 * Parakeet is 740 MB, so it comes down on first use rather than in the installer. The revision and
 * hash are the ones Handy's catalogue pins (src-tauri/src/catalog/catalog.json at 7bfb2e2c).
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export const PARAKEET_MODEL = {
  file: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
  url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/85ac09ea12fc4b1112fa76810059364bc6adc9de/parakeet-tdt-0.6b-v3-Q8_0.gguf",
  size: 739_508_576,
  sha256: "5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7",
} as const;

/**
 * English only, 229 MB. On 240 of his clips it agreed with Wispr exactly as well as v3 (3.04% of
 * words) and ran 3.4 times faster, so it is one tray click away.
 */
export const PARAKEET_FAST_MODEL = {
  file: "parakeet-tdt_ctc-110m-F16.gguf",
  url: "https://huggingface.co/handy-computer/parakeet-tdt_ctc-110m-gguf/resolve/9d66d34f9e1594075c5dd72c90c0f4c321b29f21/parakeet-tdt_ctc-110m-F16.gguf",
  size: 229334560,
  sha256: "965cc3f8e171286ecb4d4e6646b407a1782a97da9aed22f88d1e0ec6c96b2358",
} as const;

export interface DownloadableModel {
  readonly file: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

/** Download unless present at the right size. Nothing reaches `file` until its hash matches. */
export const ensureModel = async (input: {
  readonly dir: string;
  readonly model: DownloadableModel;
  readonly onProgress: (fraction: number) => void;
  readonly fetchImpl?: typeof fetch;
}): Promise<string> => {
  const target = NodePath.join(input.dir, input.model.file);
  const existing = await NodeFSP.stat(target).catch(() => null);
  if (existing?.size === input.model.size) return target;

  await NodeFSP.mkdir(input.dir, { recursive: true });
  const part = `${target}.part`;
  const response = await (input.fetchImpl ?? fetch)(input.model.url);
  if (!response.ok || response.body === null) {
    throw new Error(`Could not download ${input.model.file} (${response.status}).`);
  }
  const hash = NodeCrypto.createHash("sha256");
  const out = NodeFS.createWriteStream(part);
  let received = 0;
  let shown = -1;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk))
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      const percent = Math.floor((received / input.model.size) * 100);
      if (percent !== shown) {
        shown = percent;
        input.onProgress(percent / 100);
      }
    }
    await new Promise<void>((resolve, reject) =>
      out.end((e?: Error | null) => (e ? reject(e) : resolve())),
    );
    if (hash.digest("hex") !== input.model.sha256) {
      throw new Error(`${input.model.file} did not match its checksum.`);
    }
    await NodeFSP.rename(part, target);
    return target;
  } catch (error) {
    out.destroy();
    await NodeFSP.rm(part, { force: true });
    throw error;
  }
};
