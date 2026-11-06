// @effect-diagnostics globalTimers:off -- the worker restart runs on child-process callbacks outside Effect.
/**
 * The main process's side of the ONNX worker: the same scorers the voice core used in-process, answered by a
 * child process. A crashed child is restarted; while it is down every score is "nothing heard", never an error,
 * because one rejected score would stop the provider's queue for good.
 */
import {
  createOpenWakeWordScorer,
  createSileroScorer,
  type OpenWakeWordPaths,
  type OpenWakeWordScorer,
  type SileroScorer,
} from "@t3tools/baton-voice";

export type OnnxRequest =
  | { readonly op: "open-wake"; readonly id: number; readonly paths: OpenWakeWordPaths }
  | { readonly op: "open-vad"; readonly id: number; readonly path: string }
  | { readonly op: "wake" | "vad"; readonly id: number; readonly chunk: Int16Array }
  | { readonly op: "reset-wake" | "reset-vad" };

export type OnnxReply =
  | { readonly id: number; readonly value: number | ReadonlyArray<number> }
  | { readonly id: number; readonly error: string };

/** One request at a time, in order, so a reset never lands in the middle of a score. */
export const serveOnnx = (
  post: (reply: OnnxReply) => void,
  make = { wake: createOpenWakeWordScorer, vad: createSileroScorer },
) => {
  let wake: OpenWakeWordScorer | null = null;
  let vad: SileroScorer | null = null;
  let queue: Promise<void> = Promise.resolve();
  const run = async (request: OnnxRequest) => {
    switch (request.op) {
      case "open-wake":
        wake = await make.wake(request.paths);
        return post({ id: request.id, value: wake.chunkSamples });
      case "open-vad":
        vad = await make.vad(request.path);
        return post({ id: request.id, value: vad.chunkSamples });
      case "wake":
        if (wake === null) throw new Error("no wake model open");
        return post({ id: request.id, value: await wake.score(request.chunk) });
      case "vad":
        if (vad === null) throw new Error("no speech model open");
        return post({ id: request.id, value: await vad.score(request.chunk) });
      case "reset-wake":
        return wake?.reset();
      case "reset-vad":
        return vad?.reset();
    }
  };
  return (request: OnnxRequest) => {
    queue = queue.then(() =>
      run(request).catch((error: unknown) => {
        if ("id" in request) post({ id: request.id, error: String(error) });
      }),
    );
  };
};

export interface OnnxChild {
  readonly postMessage: (request: OnnxRequest) => void;
  readonly onMessage: (listener: (reply: OnnxReply) => void) => void;
  readonly onExit: (listener: (code: number) => void) => void;
  readonly kill: () => void;
}

const FIRST_RESTART_MS = 1_000;
const MAX_RESTART_MS = 60_000;

export const createOnnxHost = (input: {
  readonly fork: () => OnnxChild;
  /** Once per run, at the first crash after the models loaded: the voice says it is listening again. */
  readonly onCrash: (code: number) => void;
}) => {
  let child: OnnxChild | null = null;
  let id = 0;
  const pending = new Map<
    number,
    {
      readonly resolve: (value: never) => void;
      readonly reject: (error: Error) => void;
      readonly fallback?: unknown;
    }
  >();
  const opened: OnnxRequest[] = [];
  let told = false;
  let closed = false;
  let restartMs = FIRST_RESTART_MS;

  const start = () => {
    const current = input.fork();
    child = current;
    current.onMessage((reply) => {
      const waiting = pending.get(reply.id);
      if (waiting === undefined) return;
      pending.delete(reply.id);
      if (!("error" in reply)) waiting.resolve(reply.value as never);
      else if (waiting.fallback !== undefined) waiting.resolve(waiting.fallback as never);
      else waiting.reject(new Error(reply.error));
    });
    current.onExit((code) => {
      if (child !== current) return;
      child = null;
      for (const [key, waiting] of pending) {
        pending.delete(key);
        if (waiting.fallback !== undefined) waiting.resolve(waiting.fallback as never);
        else waiting.reject(new Error(`voice model process exited (${code})`));
      }
      if (closed || opened.length === 0) return;
      if (!told) {
        told = true;
        input.onCrash(code);
      }
      setTimeout(restart, restartMs).unref();
      restartMs = Math.min(restartMs * 2, MAX_RESTART_MS);
    });
  };
  const restart = () => {
    if (closed || child !== null) return;
    start();
    // The worker answers in order, so scores sent after these wait for the models to load again.
    for (const request of opened) child!.postMessage({ ...request, id: (id += 1) } as OnnxRequest);
  };

  const call = <T>(request: OnnxRequest & { readonly id: number }, fallback?: T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (child === null) {
        if (fallback !== undefined) return resolve(fallback);
        if (closed) return reject(new Error("voice model process closed"));
        start();
      }
      pending.set(request.id, {
        resolve: resolve as (value: never) => void,
        reject,
        ...(fallback === undefined ? {} : { fallback }),
      });
      child!.postMessage(request);
    });
  const open = async (request: OnnxRequest & { readonly id: number }) => {
    const chunkSamples = await call<number>(request);
    const slot = opened.findIndex((r) => r.op === request.op);
    if (slot >= 0) opened.splice(slot, 1);
    opened.push(request);
    return chunkSamples;
  };

  return {
    wake: async (paths: OpenWakeWordPaths): Promise<OpenWakeWordScorer> => {
      const silent = paths.wakes.map(() => 0);
      return {
        chunkSamples: await open({ op: "open-wake", id: (id += 1), paths }),
        score: (chunk) => call({ op: "wake", id: (id += 1), chunk }, silent),
        reset: () => child?.postMessage({ op: "reset-wake" }),
      };
    },
    vad: async (path: string): Promise<SileroScorer> => ({
      chunkSamples: await open({ op: "open-vad", id: (id += 1), path }),
      score: (chunk) => call({ op: "vad", id: (id += 1), chunk }, 0),
      reset: () => child?.postMessage({ op: "reset-vad" }),
    }),
    close: () => {
      closed = true;
      child?.kill();
    },
  };
};
