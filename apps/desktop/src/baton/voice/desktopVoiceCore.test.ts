/* oxlint-disable t3code/no-low-value-comments, t3code/no-test-timeout-or-unreasoned-skip, t3code/no-wall-clock-in-tests -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics globalConsole:off globalDate:off nodeBuiltinImport:off
/**
 * The desktop's capture → core loop with the REAL core: the voice lane's
 * espeak-ng fixtures as the microphone, openWakeWord → Silero → whisper.cpp →
 * mode machine → router → the real grammar, and the HUD's last-words line.
 *
 * Needs the models and whisper-cli (docs/baton/VOICE.md); skipped otherwise:
 *   BATON_VOICE_MODELS=<dir>  BATON_WHISPER_CLI=<whisper-cli>
 */
import * as NodePath from "node:path";

import type { BatonFocusTarget } from "@t3tools/baton-contracts";
import { resolveBatonIntent, type IntentVocabulary } from "@t3tools/baton-shared/intentParser";
import { describe, expect, it } from "vite-plus/test";

import {
  createDesktopVoiceCore,
  desktopVoiceContext,
  makeVoiceIntentClient,
  missingVoiceAssets,
  resolveVoiceAssets,
  sessionMessageSentence,
  type VoiceIntentRequest,
} from "./desktopVoiceCore.ts";
import { makeWavFileAudioInput, wavDeviceId } from "./WavFileAudioInput.ts";
import { utteranceCaption } from "./voiceHud.ts";
import { startVoiceLoop } from "./voiceLoop.ts";
import type { VoiceState } from "./voiceTypes.ts";

const fleet: IntentVocabulary = {
  workSessions: [
    {
      id: "ws-ventureos",
      title: "Niche radar tests",
      projectId: "project-ventureos",
      projectLabel: "VentureOS",
      needsApproval: false,
      updatedAt: "2026-10-26T05:00:00.000Z",
    },
    {
      id: "ws-margin",
      title: "Search ranking",
      projectId: "project-margin",
      projectLabel: "The Margin",
      needsApproval: false,
      updatedAt: "2026-10-26T06:00:00.000Z",
    },
  ],
  projects: [
    { id: "project-ventureos", title: "VentureOS" },
    { id: "project-margin", title: "The Margin" },
  ],
  providers: [],
  openGates: [],
  hostAliases: [],
  focusedWorkSessionId: null,
};

const field: BatonFocusTarget = {
  producer: "desktop",
  kind: "editable",
  label: "the focused field",
  injectable: true,
  origin: null,
};

/** The renderer's two RPCs, answered by the real grammar. */
const grammarRenderer = () => {
  const requests: VoiceIntentRequest[] = [];
  const request = async (r: VoiceIntentRequest) => {
    requests.push(r);
    const resolution = resolveBatonIntent(r.text, {
      ...fleet,
      focusedWorkSessionId: r.focusedWorkSessionId,
    });
    if (r.kind === "resolve") return resolution;
    return { resolution, reply: resolution.outcome === "resolved" ? "Done." : "Refused." };
  };
  return { request, requests };
};

describe("the intent bridge", () => {
  it("sends direct-session speech to the given session, word for word", async () => {
    const { request, requests } = grammarRenderer();
    const client = makeVoiceIntentClient({
      request,
      field,
      injection: { method: "clipboard", canInject: () => true, insertText: async () => {} },
    });
    await client.sendToSession({ workSessionId: "ws-ventureos", text: "run the migration tests" });
    expect(requests[0]).toEqual({
      kind: "run",
      text: sessionMessageSentence("run the migration tests"),
      focusedWorkSessionId: "ws-ventureos",
    });
    const resolved = resolveBatonIntent(requests[0]!.text, {
      ...fleet,
      focusedWorkSessionId: "ws-ventureos",
    });
    // The focused one, not the one that moved last (ws-margin).
    expect(resolved.outcome === "resolved" && resolved.workSessionId).toBe("ws-ventureos");
    expect(
      resolved.outcome === "resolved" &&
        resolved.command.kind === "message_work_session" &&
        resolved.command.text,
    ).toBe("run the migration tests");
  });

  it("reports a refused paste as not inserted rather than throwing", async () => {
    const client = makeVoiceIntentClient({
      request: async () => null,
      field,
      injection: {
        method: "clipboard",
        canInject: () => false,
        insertText: async () => {
          throw new Error("no paste here");
        },
      },
    });
    expect(await client.insertText({ text: "hello" })).toEqual({ inserted: false });
  });

  it("finds the models in the state dir unless told otherwise, and names what is missing", () => {
    const assets = resolveVoiceAssets({ stateDir: "/s", platform: "win32", env: {} });
    expect(assets.whisperCli).toBe(NodePath.join("/s", "voice", "whisper-cli.exe"));
    expect(missingVoiceAssets(assets, () => false)).toHaveLength(6);
    expect(
      resolveVoiceAssets({ stateDir: "/s", platform: "linux", env: { BATON_VOICE_MODELS: "/m" } })
        .modelsDir,
    ).toBe("/m");
  });
});

const env = {
  BATON_VOICE_MODELS: process.env.BATON_VOICE_MODELS,
  BATON_WHISPER_CLI: process.env.BATON_WHISPER_CLI,
};
const assets = resolveVoiceAssets({ stateDir: "/nonexistent", platform: "linux", env });
const ready =
  env.BATON_VOICE_MODELS !== undefined &&
  env.BATON_WHISPER_CLI !== undefined &&
  missingVoiceAssets(assets).length === 0;
const fixtures = NodePath.resolve(
  import.meta.dirname,
  "../../../../../packages/baton-voice/test/fixtures",
);
const wav = (name: string) => NodePath.join(fixtures, `${name}.wav`);

describe.skipIf(!ready)("WAV as the mic, through the real core", () => {
  it("wake → VAD → STT → intent → the HUD's last-words line", { timeout: 240_000 }, async () => {
    const { request, requests } = grammarRenderer();
    const inserted: string[] = [];
    const replies: string[] = [];
    const { core, drain } = await createDesktopVoiceCore({
      assets,
      platform: "linux",
      speak: false,
      origin: Date.now(),
      onReply: (text) => replies.push(text),
      intent: makeVoiceIntentClient({
        request,
        field,
        injection: {
          method: "clipboard",
          canInject: () => true,
          insertText: async ({ text }) => void inserted.push(text),
        },
      }),
    });
    const files = ["wake-status", "followup", "dictate", "stop-dictating"].map(wav);
    const states: VoiceState[] = [];
    const captions: string[] = [];
    const refresh = () =>
      core.setContext(
        desktopVoiceContext({ focusedWorkSessionId: null, field, observedAt: new Date() }),
      );
    refresh();
    const loop = await startVoiceLoop({
      audio: makeWavFileAudioInput(files, { afterFrame: drain }),
      core,
      deviceId: wavDeviceId(files[0]!),
      onState: (s) => states.push(s),
      onUtterance: (u) => captions.push(utteranceCaption(u)),
    });
    await core.idle();
    const play = async (index: number) => {
      refresh();
      await loop.switchDevice(wavDeviceId(files[index]!));
      await core.idle();
    };

    // "Hey Jarvis, what is VentureOS doing?" — woken, transcribed, run.
    expect(states).toContain("command_window");
    expect(captions[0]).toMatch(/^“What is VentureOS doing\?” to Baton$/i);
    expect(requests.some((r) => r.kind === "run" && /VentureOS doing/i.test(r.text))).toBe(true);

    // Follow-up without a wake: conversation mode, target inherited.
    await play(1);
    expect(states).toContain("conversation");
    expect(captions.at(-1)).toMatch(/run the other test too/i);
    expect(requests.findLast((r) => r.kind === "run")?.focusedWorkSessionId).toBe("ws-ventureos");

    // Dictation is typed into the field and never reaches the intent path.
    await play(2);
    expect(core.snapshot().state).toBe("dictation");
    expect(inserted.join(" ")).toMatch(/revised version tomorrow/i);
    expect(captions.at(-1)).toMatch(
      /^“Thanks, I will send the revised version tomorrow\.” typed into the focused field$/,
    );
    await play(3);
    expect(core.snapshot().machine.mode).not.toBe("dictation");
    expect(requests.some((r) => /revised/i.test(r.text))).toBe(false);

    expect(replies.length).toBeGreaterThan(0);
    console.log(["captions:", ...captions, "replies:", ...replies].join("\n  "));
    await loop.stop();
  });
});
