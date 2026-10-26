# Fabric Voice Service (`packages/fabric-voice`)

The §12.2 pipeline: **audio → wake → VAD → STT → mode machine → router → the
existing intent path → destination → spoken reply**. The desktop owns the
microphone, tray and HUD (`apps/desktop/src/fabric/voice`, D65/D66); this
package is the core it plugs in through `makeCore`.

## Pieces

| File                  | What it is                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`            | `AudioInputProvider`, `WakeProvider`, `VadProvider`, `SttProvider`, `TtsProvider`, and the desktop's `VoiceCore` seam (same shapes as `voiceTypes.ts`) |
| `modeMachine.ts`      | §12.3 as a pure reducer: sleeping → command window → conversation → base; direct-session; dictation; spoken confirmations                              |
| `router.ts`           | Effects → `fabric.intent.resolve` / `fabric.intent.run` with high-risk checks before and after, §14 destinations, dictation kept local                 |
| `core.ts`             | Frames → wake/VAD segmentation → STT → machine → router → TTS; implements `VoiceCore` plus snapshot and an event stream                                |
| `service.ts`          | The local API below                                                                                                                                    |
| `providers/onnx.ts`   | openWakeWord ("hey jarvis") and Silero VAD on onnxruntime-node                                                                                         |
| `providers/speech.ts` | whisper.cpp (`whisper-cli`), optional cloud STT (OpenAI-compatible `/audio/transcriptions`), OS TTS, WAV encode/decode                                 |

Versions, licences and hashes: `docs/fabric/research/voice-stack-2026-10-26.md`.

## Modes (§12.3)

- **sleeping**: only the wake detector runs. Speech without a wake is ignored.
- **command_window** (8 s): opened by "hey jarvis" or the tray/hotkey `wake`. The wake
  phrase and the command can be said together.
- **conversation** (30 s, extended by every command): follow-ups need no wake and
  inherit the target the last command touched. "That's all" or the timeout ends it.
- **direct_session**: the resting mode when the toggle is on. Plain speech is a user
  message to the **focused** session (only a focused one; "most recent" is not enough).
  A wake still opens a command window.
- **dictation**: "dictate" (optionally with text in the same breath) enters it, and only
  "stop dictating" leaves it. While it is on, everything said is text for the
  focused field, including words that sound like commands. Dictated text never
  reaches the environment.

## Safety

- The §24.1 high-risk patterns (`highRiskSubject`) are checked on the transcript before
  anything leaves the client, and the resolution's `risk` is checked again on the way back.
  High risk is refused by voice, full stop.
- Medium risk (start/resume work, answering a gate) is read back and needs a **later,
  separate** "confirm" within 15 s. The wake phrase is stripped before that check, so a
  wake word can never be the yes. The command is re-resolved at run time, and each
  token works once.

## Local API (in-process; the desktop forwards it over its ipcMain channel)

```ts
import {
  createVoiceCore,
  createVoiceRouter,
  createVoiceService,
  createOpenWakeWordProvider,
  createSileroVad,
  createWhisperCppStt,
  createOsTts,
} from "@t3tools/fabric-voice";

const core = createVoiceCore({
  wake: await createOpenWakeWordProvider({ melspectrogram, embedding, wake: heyJarvis }),
  vad: await createSileroVad(sileroPath),
  stt: createWhisperCppStt({
    binary: whisperCli,
    model: ggmlBaseEn,
    vocabulary: () => projectNames,
  }),
  tts: createOsTts(process.platform),
  router: createVoiceRouter(intentClient), // omit to route utterances yourself
});
const voice = createVoiceService({ audio, core });
```

| Call                                         | Does                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `start({ deviceId? })` / `stop()`            | Start or stop capture through the `AudioInputProvider`                            |
| `listDevices()` / `selectDevice(id \| null)` | Enumerate and pin; an unknown id falls back to the OS default; switches live      |
| `setDirectSession(bool)`, `wake()`           | Tray toggles / hotkey                                                             |
| `snapshot()`                                 | `{ running, deviceId, state, lastTranscript, currentTarget, machine }`            |
| `subscribe(fn)`                              | Events: `state` (with target), `wake`, `transcript`, `effect`, `outcome`, `error` |
| `core.setContext(bus)`                       | Push the context bus state (§14 ladder, dictation target)                         |

`intentClient` (`VoiceIntentClient`) is four calls the desktop already has: `resolve`
and `run` (the `fabric.intent.*` RPCs, so grammar → learned → model reading and the
server's gates all apply), `sendToSession` (direct-session), and `insertText` (§18).

There is deliberately no loopback HTTP port: a web page can reach localhost, and the
desktop main process imports this package directly.

## Tests

- `src/modeMachine.test.ts`, `src/router.test.ts`: unit tests, no models.
- `test/e2e.test.ts`: espeak-ng WAV fixtures (`test/make-fixtures.sh`) through the real
  openWakeWord → Silero → whisper.cpp → grammar. Skipped unless
  `FABRIC_VOICE_MODELS` and `FABRIC_WHISPER_CLI` are set; `FABRIC_VOICE_REPORT=<file>`
  writes the accuracy report.

Result on 2026-10-26 (Linux box, ggml-base.en, espeak-ng voice):

```
wake-status: wakes=1 heard="What is VentureOS doing?"
followup: wakes=0 heard="Tell it to run the other test too."
dictate: heard="Hey Jarvis, dictate. Thanks, I will send the revised version tomorrow." mode=dictation
stop-dictating: heard="Stop dictating." mode=sleeping
no-wake: wakes=0 transcripts=0
word accuracy: 1.00 1.00 1.00 1.00 mean=1.00
```

Wake: 1 of 1 true wake detected, 0 false wakes on the no-wake fixture. Four synthetic
clips from one synthetic voice is a smoke test. It says nothing yet about the DJI mic,
room noise or the Director's own voice.
