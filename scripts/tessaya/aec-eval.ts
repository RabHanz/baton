// The same barge-in measurement as bargein-eval.ts, with WebRTC AEC3 (native/baton-aec) in place of the heuristic echo guard.
// node scripts/tessaya/aec-eval.ts <path-to-aec-eval> [seconds-per-room]
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { evaluateGuard, synthMic, type EchoRun, type EchoScenario } from "../../packages/baton-voice/src/echoSim.ts";

const FRAME = 320; // 20 ms at 16 kHz, the core's frame
const CONFIRM_FRAMES = 6; // 120 ms
const OVER_RATIO = Number(process.env.AEC_OVER_RATIO ?? 0.3); // processed over mic energy: an echo is mostly removed, speech over it is not
const OVER_BASE = Number(process.env.AEC_OVER_BASE ?? 0); // and this many times the usual ratio for this room (0: ignore)

const pcm = (f: Float32Array) => Buffer.from(Int16Array.from(f, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768)))).buffer);
const energy = (a: Int16Array, from: number, n: number) => {
  let e = 0;
  for (let i = from; i < from + n; i += 1) e += a[i]! * a[i]!;
  return e / n;
};

const binary = process.argv[2];
if (binary === undefined) throw new Error("usage: aec-eval.ts <path-to-aec-eval> [seconds]");
const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "aec-"));

const run = (scenario: EchoScenario): EchoRun => {
  const mic = synthMic(scenario);
  NodeFS.writeFileSync(NodePath.join(dir, "ref.raw"), pcm(scenario.tts));
  NodeFS.writeFileSync(NodePath.join(dir, "mic.raw"), pcm(mic));
  const r = NodeChildProcess.spawnSync(binary, [NodePath.join(dir, "ref.raw"), NodePath.join(dir, "mic.raw"), NodePath.join(dir, "out.raw")], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("aec-eval failed");
  const raw = NodeFS.readFileSync(NodePath.join(dir, "out.raw"));
  const out = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const micI = new Int16Array(pcm(mic).buffer);
  const detections: number[] = [];
  let streak = 0;
  let base = 0.1;
  for (let f = 0; (f + 1) * FRAME <= out.length; f += 1) {
    const eo = energy(out, f * FRAME, FRAME);
    const em = energy(micI, f * FRAME, FRAME);
    const ratio = em > 1e4 ? eo / em : 0;
    const flagged = ratio > OVER_RATIO && ratio > OVER_BASE * base && f * 0.02 > 1.5; // not before the filter has had a second or so to converge
    if (!flagged && ratio > 0) base += (ratio - base) * 0.01;
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
  NodeFS.rmSync(dir, { recursive: true, force: true });
}
