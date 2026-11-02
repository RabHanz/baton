// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// One clip per task: ffmpeg grabs the runner's desktop at 10 fps, 720p, and a contact sheet of six frames is made
// from it, so a run can be looked at without playing it. The runner desktop holds nothing private.
// Off unless HANDS_RECORD is set (CI sets it); a missing ffmpeg only means no clips, never a failed task.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

const FFMPEG = process.env["FFMPEG"] ?? "ffmpeg";
export const recording = (process.env["HANDS_RECORD"] ?? "") !== "";

const run = (args: string[], timeoutMs = 60_000): Promise<number> =>
  new Promise((resolve) => {
    const child = NodeChildProcess.spawn(FFMPEG, args, {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", () => resolve(-1));
    child.on("exit", (code) => (clearTimeout(timer), resolve(code ?? -1)));
  });

export interface Clip {
  /** Ends the recording, finishes the file, and writes the contact sheet. */
  readonly stop: (seconds: number) => Promise<void>;
}

export const startClip = (dir: string, id: string): Clip | null => {
  if (!recording) return null;
  const file = NodePath.join(dir, `${id}.mp4`);
  const child = NodeChildProcess.spawn(
    FFMPEG,
    [
      "-y",
      "-f",
      "gdigrab",
      "-framerate",
      "10",
      "-i",
      "desktop",
      "-vf",
      "scale=-2:720",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
  );
  let failed = false;
  child.on("error", () => (failed = true));
  child.stdin.on("error", () => undefined);
  return {
    stop: async (seconds) => {
      if (failed) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => (child.kill(), resolve()), 15_000);
        child.on("exit", () => (clearTimeout(timer), resolve()));
        child.stdin.write("q");
      });
      // Six frames spread over the clip, three across and two down.
      const rate = (6 / Math.max(seconds, 1)).toFixed(4);
      await run([
        "-y",
        "-i",
        file,
        "-vf",
        `fps=${rate},scale=426:-2,tile=3x2`,
        "-frames:v",
        "1",
        NodePath.join(dir, `${id}-sheet.png`),
      ]);
    },
  };
};
