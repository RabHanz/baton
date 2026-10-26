/**
 * The local API the desktop calls (docs/fabric/VOICE.md): start/stop, device
 * select, a state stream, the last transcript and the current target. In
 * process, because the desktop's main process imports this package; the
 * desktop forwards it over its own ipcMain channel. No network listener — a
 * loopback HTTP port would be one more thing a web page could reach.
 *
 * @module fabric-voice/service
 */
import type { FabricVoiceCore, VoiceCoreEvent, VoiceCoreSnapshot } from "./core.ts";
import type { AudioInputDevice, AudioInputProvider } from "./types.ts";

export interface VoiceServiceSnapshot extends VoiceCoreSnapshot {
  readonly running: boolean;
  readonly deviceId: string | null;
}

export interface FabricVoiceService {
  readonly start: (input?: { readonly deviceId?: string | null }) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly listDevices: () => Promise<ReadonlyArray<AudioInputDevice>>;
  /** Pin a device; null is the OS default. Takes effect at once when running. */
  readonly selectDevice: (deviceId: string | null) => Promise<void>;
  readonly setDirectSession: (enabled: boolean) => void;
  readonly wake: () => void;
  readonly snapshot: () => VoiceServiceSnapshot;
  readonly subscribe: (listener: (event: VoiceCoreEvent) => void) => () => void;
}

export const createVoiceService = (input: {
  readonly audio: AudioInputProvider;
  readonly core: FabricVoiceCore;
  readonly deviceId?: string | null;
}): FabricVoiceService => {
  let running = false;
  let deviceId = input.deviceId ?? null;
  const onFrame = (frame: Int16Array) => input.core.pushAudio(frame);

  return {
    start: async (options) => {
      if (options?.deviceId !== undefined) deviceId = options.deviceId;
      if (running) return;
      await input.audio.start({ deviceId, onFrame });
      running = true;
    },
    stop: async () => {
      if (!running) return;
      running = false;
      await input.audio.stop();
    },
    listDevices: () => input.audio.listDevices(),
    selectDevice: async (next) => {
      const known =
        next === null || (await input.audio.listDevices()).some((d) => d.deviceId === next);
      // A pinned device that is gone falls back to the OS default (§12.1).
      deviceId = known ? next : null;
      if (!running) return;
      await input.audio.stop();
      await input.audio.start({ deviceId, onFrame });
    },
    setDirectSession: (enabled) => input.core.setDirectSession(enabled),
    wake: () => input.core.activate("wake"),
    snapshot: () => ({ ...input.core.snapshot(), running, deviceId }),
    subscribe: (listener) => input.core.subscribe(listener),
  };
};
