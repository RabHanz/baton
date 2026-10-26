/**
 * A WAV file as a microphone: the headless proof of the capture → core loop,
 * and a way to replay a recorded utterance on a box with no audio device.
 */
import * as NodeFSP from "node:fs/promises";

import { makeFramer, parseWav, toVoicePcm } from "./pcm.ts";
import type { AudioInputProvider } from "./voiceTypes.ts";

export const makeWavFileAudioInput = (path: string): AudioInputProvider => {
  let stopped = false;
  return {
    listDevices: async () => [{ deviceId: `wav:${path}`, label: `WAV file ${path}` }],
    start: async ({ onFrame }) => {
      stopped = false;
      const wav = parseWav(new Uint8Array(await NodeFSP.readFile(path)));
      const pcm = toVoicePcm(wav.samples, wav.channels, wav.sampleRate);
      const push = makeFramer((frame) => {
        if (!stopped) onFrame(frame);
      });
      // Faster than real time on purpose: the loop under test is the routing,
      // not the clock.
      push(pcm);
    },
    stop: async () => {
      stopped = true;
    },
  };
};
