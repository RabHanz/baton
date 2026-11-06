// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
/**
 * Sentence vectors for recall by meaning (MEM-13, D4 option 1): all-MiniLM-L6-v2 (int8 ONNX, Apache-2.0) on this server,
 * in a worker thread with one intra-op thread so the event loop and the rest of the machine keep their time. Words are
 * cut into WordPiece ids here (cheap); the worker only runs the model. No model or no onnxruntime on this server: `model`
 * is null and recall stays on keywords, as before.
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeWorkerThreads from "node:worker_threads";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { meanPool } from "./memoryVectors.ts";
import { createWordPiece, type WordPiece } from "./wordpiece.ts";

/** Names the vectors, so a different model's are never compared with these. */
export const MEMORY_MODEL_ID = "all-MiniLM-L6-v2-int8";
const MODEL_FILE = "model_quantized.onnx";
const VOCAB_FILE = "vocab.txt";
const DIM = 384;
/** Memory items are short; a long one is read by its first 128 tokens, which bounds the cost of one. */
const MAX_TOKENS = 128;
const CALL_MS = 10_000;

/** The model run failed or timed out; recall then goes on without this sentence's vector. */
export class BatonMemoryEmbedError extends Schema.TaggedError<BatonMemoryEmbedError>()(
  "BatonMemoryEmbedError",
  { reason: Schema.String },
) {}

export class BatonMemoryEmbedder extends Context.Service<
  BatonMemoryEmbedder,
  {
    /** The model's id, or null when this server has none (keyword recall only). */
    readonly model: string | null;
    /** The text's unit vector, or null when the model is missing or the call failed. */
    readonly embed: (text: string) => Effect.Effect<Float32Array | null>;
  }
>()("t3/baton/BatonMemoryEmbedder") {}

/** No model: recall is keyword-only. Tests and a server without the files use this. */
const noModel = BatonMemoryEmbedder.of({
  model: null,
  embed: Effect.fn("BatonMemoryEmbedder.embed")(function* (_text: string) {
    return null;
  }),
});
export const layerNone = Layer.succeed(BatonMemoryEmbedder, noModel);

/** The worker: only the ONNX session, loaded once; one message in, the token vectors out. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const ort = require(workerData.ort);
let session = null;
parentPort.on("message", async ({ id, ids }) => {
  try {
    session ??= await ort.InferenceSession.create(workerData.model, {
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      executionMode: "sequential",
    });
    const shape = [1, ids.length];
    const tensor = (values) => new ort.Tensor("int64", BigInt64Array.from(values, BigInt), shape);
    const out = await session.run({
      input_ids: tensor(ids),
      attention_mask: tensor(ids.map(() => 1)),
      token_type_ids: tensor(ids.map(() => 0)),
    });
    const hidden = out.last_hidden_state;
    parentPort.postMessage({ id, data: hidden.data });
  } catch (error) {
    parentPort.postMessage({ id, error: String((error && error.message) || error) });
  }
});
`;

/** Where the model files are: an explicit folder, beside the server executable, or the repo's resources in development. */
const modelDirs = (): ReadonlyArray<string> => [
  ...(process.env["TESSAYA_MEMORY_MODEL_DIR"] ? [process.env["TESSAYA_MEMORY_MODEL_DIR"]] : []),
  NodePath.join(NodePath.dirname(process.execPath), "memory-model"),
  NodeURL.fileURLToPath(new URL("../../resources/memory-model", import.meta.url)),
];

const findModel = (): { readonly dir: string; readonly ort: string } | null => {
  const dir = modelDirs().find(
    (d) =>
      NodeFS.existsSync(NodePath.join(d, MODEL_FILE)) &&
      NodeFS.existsSync(NodePath.join(d, VOCAB_FILE)),
  );
  if (dir === undefined) return null;
  try {
    // As node-pty: the native addon stays outside the bundle, so it is resolved from disk.
    const ort = NodeModule.createRequire(import.meta.url).resolve("onnxruntime-node");
    return { dir, ort };
  } catch {
    return null;
  }
};

const make = Effect.gen(function* () {
  const found = findModel();
  if (found === null) {
    yield* Effect.logInfo(
      "memory recall by meaning is off: no model or onnxruntime on this server",
    );
    return noModel;
  }
  const words: WordPiece = createWordPiece(
    NodeFS.readFileSync(NodePath.join(found.dir, VOCAB_FILE), "utf8"),
  );
  let worker: NodeWorkerThreads.Worker | null = null;
  let next = 0;
  const waiting = new Map<number, (reply: { data?: Float32Array; error?: string }) => void>();
  const start = () => {
    const made = new NodeWorkerThreads.Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { ort: found.ort, model: NodePath.join(found.dir, MODEL_FILE) },
      // Its own small heap: a runaway model run cannot take the server's.
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    made.unref();
    made.on("message", (reply: { id: number; data?: Float32Array; error?: string }) => {
      waiting.get(reply.id)?.(reply);
      waiting.delete(reply.id);
    });
    // A worker that died answers everyone waiting with an error, and the next call starts a fresh one.
    made.on("exit", () => {
      if (worker === made) worker = null;
      for (const [, answer] of waiting) answer({ error: "the embedding worker stopped" });
      waiting.clear();
    });
    return made;
  };
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      await worker?.terminate();
    }),
  );
  const run = (ids: ReadonlyArray<number>) =>
    new Promise<Float32Array>((resolve, reject) => {
      worker ??= start();
      const id = (next += 1);
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error("the embedding worker did not answer"));
      }, CALL_MS);
      waiting.set(id, (reply) => {
        clearTimeout(timer);
        if (reply.data !== undefined) resolve(reply.data);
        else reject(new Error(reply.error ?? "no answer"));
      });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker thread, not a window: there is no origin
      worker.postMessage({ id, ids });
    });
  return BatonMemoryEmbedder.of({
    model: MEMORY_MODEL_ID,
    embed: Effect.fn("BatonMemoryEmbedder.embed")(function* (text: string) {
      const ids = words.encode(text, MAX_TOKENS);
      return yield* Effect.tryPromise({
        try: () => run(ids),
        catch: (error) =>
          new BatonMemoryEmbedError({
            reason: error instanceof Error ? error.message : String(error),
          }),
      }).pipe(
        Effect.map((hidden) => meanPool(hidden, ids.length, DIM)),
        Effect.catch((error) =>
          Effect.logWarning("memory embedding failed", error).pipe(Effect.as(null)),
        ),
      );
    }),
  });
});

export const layer = Layer.effect(BatonMemoryEmbedder, make);
