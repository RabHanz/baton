// The same barge-in measurement as bargein-eval.ts, with WebRTC AEC3 (native/baton-aec) in place of the heuristic echo guard.
// node scripts/tessaya/aec-eval.ts <path-to-aec-eval> [seconds-per-room]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGuard, synthMic, type EchoRun, type EchoScenario } from "../../packages/baton-voice/src/echoSim.ts";

const FRAME = 320; // 20 ms at 16 kHz, the core's frame
const CONFIRM_FRAMES = 6; // 120 ms
const OVER_RATIO = Number(process.env.AEC_OVER_RATIO ?? 0.3); // processed over mic energy: an echo is mostly removed, speech over it is not

const pcm = (f: Float32Array) => Buffer.from(Int16Array.from(f, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768)))).buffer);
const energy = (a: Int16Array, from: number, n: number) => {
  let e = 0;
  for (let i = from; i < from + n; i += 1) e += a[i]! * a[i]!;
  return e / n;
};

const binary = process.argv[2];
if (binary === undefined) throw new Error("usage: aec-eval.ts <path-to-aec-eval> [seconds]");
const dir = mkdtempSync(join(tmpdir(), "aec-"));

const run = (scenario: EchoScenario): EchoRun => {
  const mic = synthMic(scenario);
  writeFileSync(join(dir, "ref.raw"), pcm(scenario.tts));
  writeFileSync(join(dir, "mic.raw"), pcm(mic));
  const r = spawnSync(binary, [join(dir, "ref.raw"), join(dir, "mic.raw"), join(dir, "out.raw")], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("aec-eval failed");
  const raw = readFileSync(join(dir, "out.raw"));
  const out = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const micI = new Int16Array(pcm(mic).buffer);
  const detections: number[] = [];
  let streak = 0;
  for (let f = 0; (f + 1) * FRAME <= out.length; f += 1) {
    const eo = energy(out, f * FRAME, FRAME);
    const em = energy(micI, f * FRAME, FRAME);
    const flagged = em > 1e4 && eo / em > OVER_RATIO && f * 0.02 > 1.5; // not before the filter has had a second or so to converge
    streak = flagged ? streak + 1 : 0;
    if (streak === CONFIRM_FRAMES) detections.push(((f + 1) * FRAME) / 16_000);
  }
  return { detections, readyAtS: null, seconds: mic.length / 16_000 };
};

try {
  const result = evaluateGuard({ seconds: Number(process.argv[3] ?? 120), levelsDb: [-6, 0, 6, 12], run });
  console.log(JSON.stringify(result, null, 2));
  const ok = result.falsePer10Min <= 1 && (result.recall["0"] ?? 0) >= 0.9;
  console.log(ok ? "meets the target" : "does not meet the target (under 1 false per 10 min and recall >= 0.9 at 0 dB)");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
