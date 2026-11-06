import { assert, it, vi } from "vite-plus/test";

import { createOnnxHost, serveOnnx, type OnnxChild, type OnnxReply } from "./onnxHost.ts";

const paths = {
  melspectrogram: "mel.onnx",
  embedding: "embed.onnx",
  wakes: [{ word: "tessaya", path: "tessaya.onnx", threshold: 0.5 }],
};

/** A child that answers through the real request loop, with scorers that need no models. */
const fakeChildren = () => {
  const children: Array<{ readonly exit: (code: number) => void; readonly opened: string[] }> = [];
  const fork = (): OnnxChild => {
    const listeners: Array<(reply: OnnxReply) => void> = [];
    const exits: Array<(code: number) => void> = [];
    const opened: string[] = [];
    let alive = true;
    const handle = serveOnnx(
      (reply) => {
        if (alive) for (const listener of listeners) listener(reply);
      },
      {
        wake: async () => {
          opened.push("wake");
          return { chunkSamples: 1280, score: async () => [0.9], reset: () => undefined };
        },
        vad: async () => {
          opened.push("vad");
          return { chunkSamples: 512, score: async () => 0.8, reset: () => undefined };
        },
      },
    );
    children.push({
      opened,
      exit: (code) => {
        alive = false;
        for (const exit of exits) exit(code);
      },
    });
    return {
      postMessage: (request) => {
        if (alive) handle(request);
      },
      onMessage: (listener) => listeners.push(listener),
      onExit: (listener) => exits.push(listener),
      kill: () => undefined,
    };
  };
  return { children, fork };
};

it("scores through the worker, hears nothing while it is down, and reloads the models after a crash", async () => {
  vi.useFakeTimers();
  const { children, fork } = fakeChildren();
  const crashes: number[] = [];
  const host = createOnnxHost({ fork, onCrash: (code) => crashes.push(code) });
  const wake = await host.wake(paths);
  const vad = await host.vad("silero.onnx");
  assert.deepEqual(await wake.score(new Int16Array(1280)), [0.9]);
  assert.equal(await vad.score(new Int16Array(512)), 0.8);

  // In flight when the worker dies: answered as silence, never rejected (a rejection stops the provider's queue).
  const inFlight = wake.score(new Int16Array(1280));
  children[0]!.exit(1);
  assert.deepEqual(await inFlight, [0]);
  assert.equal(await vad.score(new Int16Array(512)), 0);
  assert.deepEqual(crashes, [1]);

  vi.runAllTimers();
  assert.lengthOf(children, 2);
  assert.deepEqual(await wake.score(new Int16Array(1280)), [0.9]);
  assert.deepEqual(children[1]!.opened, ["wake", "vad"]);

  // A second crash restarts again but says nothing more.
  children[1]!.exit(2);
  vi.runAllTimers();
  vi.useRealTimers();
  assert.deepEqual(crashes, [1]);
  assert.equal(await vad.score(new Int16Array(512)), 0.8);
  host.close();
});

it("fails the first load, so voice reports it instead of listening to nothing", async () => {
  const host = createOnnxHost({
    fork: () => ({
      postMessage: () => undefined,
      onMessage: () => undefined,
      onExit: (listener) => queueMicrotask(() => listener(3)),
      kill: () => undefined,
    }),
    onCrash: () => assert.fail("not a crash after loading"),
  });
  let error: unknown = null;
  await host.wake(paths).catch((e: unknown) => (error = e));
  assert.match(String(error), /exited \(3\)/);
});
