import { describe, expect, it } from "vite-plus/test";

import {
  captureSize,
  pointable,
  describeDrivePlan,
  needsCaptureApproval,
  parseReply,
  parseScreenIntent,
  parseVerify,
  planFromReply,
  runDrivePlan,
  screenDifference,
  shotFor,
  toDesktop,
  validateDrivePlan,
  type DriveHost,
  type ScreenShot,
} from "./screenCompanion.ts";

// Two displays: a 2560×1440 laptop panel at 150 % (1707×960 DIP) left of a 1920×1080 monitor.
const laptop: ScreenShot = {
  screen: 1,
  width: 1280,
  height: 720,
  cursorHere: true,
  bounds: { x: 0, y: 0, width: 1707, height: 960 },
};
const monitor: ScreenShot = {
  screen: 2,
  width: 1280,
  height: 720,
  cursorHere: false,
  bounds: { x: 1707, y: 0, width: 1920, height: 1080 },
};
const shots = [laptop, monitor];

describe("parseReply", () => {
  it("takes farzaa's tag off the end and keeps the spoken text", () => {
    const r = parseReply(
      "see that source control menu up top? click that. [POINT:285,11:source control]",
    );
    expect(r.spoken).toBe("see that source control menu up top? click that.");
    expect(r.point).toEqual({ x: 285, y: 11, label: "source control", screen: null, confidence: null });
    expect(r.done).toBe(false);
  });

  it("reads the screen suffix and [POINT:none]", () => {
    expect(parseReply("over there [POINT:400,300:terminal:screen2]").point).toEqual({
      x: 400,
      y: 300,
      label: "terminal",
      screen: 2,
      confidence: null,
    });
    const none = parseReply("html is the skeleton of a page. [POINT:none]");
    expect(none.point).toBeNull();
    expect(none.spoken).toBe("html is the skeleton of a page.");
  });

  it("accepts a tag without a label, and the last of several", () => {
    expect(parseReply("[POINT:1,2] no wait [POINT:30,40:save]").point?.x).toBe(30);
    expect(parseReply("here [POINT:5,6]").point).toEqual({ x: 5, y: 6, label: null, screen: null, confidence: null });
  });

  it("marks a finished lesson", () => {
    const r = parseReply("that's it, you're exporting. tip: shift-e does it next time. [DONE]");
    expect(r.done).toBe(true);
    expect(r.spoken).not.toContain("[DONE]");
  });

  it("separates the drive block from what is said", () => {
    const r = parseReply('i\'ll open it.\n```baton-drive\n{"title":"t","actions":[]}\n```');
    expect(r.spoken).toBe("i'll open it.");
    expect(r.planText).toBe('{"title":"t","actions":[]}');
  });
});

describe("parseVerify", () => {
  it("is ok only on [OK]", () => {
    expect(parseVerify("[OK]")).toEqual({ ok: true });
    expect(parseVerify("[STOP: a save dialog opened instead]")).toEqual({
      ok: false,
      reason: "a save dialog opened instead",
    });
    expect(parseVerify("hmm, not sure").ok).toBe(false);
  });
});

describe("coordinates", () => {
  it("scales screenshot pixels to the display and offsets by its origin", () => {
    expect(toDesktop({ x: 640, y: 360 }, laptop)).toEqual({ x: 854, y: 480 });
    expect(toDesktop({ x: 0, y: 0 }, monitor)).toEqual({ x: 1707, y: 0 });
    expect(toDesktop({ x: 1280, y: 720 }, monitor)).toEqual({ x: 3627, y: 1080 });
  });

  it("clamps points outside the image", () => {
    expect(toDesktop({ x: 5000, y: -3 }, laptop)).toEqual({ x: 1707, y: 0 });
  });

  it("picks the named screen, else the cursor's", () => {
    expect(shotFor(shots, 2)).toBe(monitor);
    expect(shotFor(shots, null)).toBe(laptop);
    expect(shotFor(shots, 9)).toBe(laptop);
  });

  it("caps the long edge at 1568 and never upscales", () => {
    expect(captureSize(2560, 1440)).toEqual({ width: 1568, height: 882 });
    expect(captureSize(1080, 1920)).toEqual({ width: 882, height: 1568 });
    expect(captureSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("measures how much of the screen changed", () => {
    const a = new Uint8Array(100).fill(10);
    const b = a.slice();
    expect(screenDifference(a, b)).toBe(0);
    b.fill(200, 0, 25);
    expect(screenDifference(a, b)).toBe(0.25);
    expect(screenDifference(a, new Uint8Array(4))).toBe(1);
  });
});

describe("validateDrivePlan (clicky-windows' rules)", () => {
  const ok = { title: "Save", actions: [{ kind: "click", x: 10, y: 10, why: "File menu" }] };

  it("accepts a well-formed plan", () => {
    expect(validateDrivePlan(ok, shots).actions).toHaveLength(1);
  });

  it.each([
    [{ actions: ok.actions }, "title"],
    [{ title: "x", actions: [] }, "1–20"],
    [
      { title: "x", actions: Array.from({ length: 21 }, () => ({ kind: "wait", seconds: 0 })) },
      "1–20",
    ],
    [{ title: "x", actions: [{ kind: "shell", cmd: "rm -rf /" }] }, "unknown kind"],
    [{ title: "x", actions: [{ kind: "click", x: 1, y: 1, script: "x" }] }, "unexpected fields"],
    [{ title: "x", actions: [{ kind: "click", x: 1 }] }, "missing y"],
    [{ title: "x", actions: [{ kind: "click", x: 1281, y: 1 }] }, "outside the screenshot"],
    [{ title: "x", actions: [{ kind: "click", x: 1, y: 1, screen: 3 }] }, "not captured"],
    [{ title: "x", actions: [{ kind: "click", x: 1, y: 1, button: "middle" }] }, "mouse button"],
    [{ title: "x", actions: [{ kind: "type", text: "a\nb" }] }, "one line"],
    [{ title: "x", actions: [{ kind: "press", keys: ["win", "r"] }] }, "Windows key"],
    [
      { title: "x", actions: [{ kind: "press", keys: ["ctrl", "alt", "delete", "shift", "a"] }] },
      "Windows key",
    ],
    [{ title: "x", actions: [{ kind: "scroll", amount: 50 }] }, "-10..10"],
    [{ title: "x", actions: [{ kind: "wait", seconds: 9 }] }, "0–5"],
  ])("refuses %j", (plan, message) => {
    expect(() => validateDrivePlan(plan, shots)).toThrow(message);
  });

  it("explains a missing or broken plan in words", () => {
    expect(planFromReply(parseReply("i can't see that window."), shots)).toEqual({
      error: "i can't see that window.",
    });
    expect(planFromReply(parseReply("ok\n```baton-drive\n{nope\n```"), shots)).toEqual({
      error: "The plan was not valid JSON.",
    });
  });

  it("describes each step for the approval dialog", () => {
    const plan = validateDrivePlan(
      {
        title: "x",
        actions: [
          { kind: "click", x: 1, y: 1, why: "File" },
          { kind: "type", text: "report.pdf" },
          { kind: "press", keys: ["ctrl", "s"] },
          { kind: "scroll", amount: -3 },
        ],
      },
      shots,
    );
    expect(describeDrivePlan(plan)).toBe(
      "1. Click: File\n2. Type “report.pdf”\n3. Press ctrl+s\n4. Scroll down 3",
    );
  });
});

describe("runDrivePlan", () => {
  const fakeHost = (over: Partial<DriveHost> = {}) => {
    const log: string[] = [];
    let at = { x: 0, y: 0 };
    const host: DriveHost = {
      moveTo: async (p) => {
        at = { ...p };
        log.push(`move ${p.x},${p.y}`);
      },
      click: async (b, n) => void log.push(`click ${b} ${n}`),
      mouseDown: async () => void log.push("down"),
      mouseUp: async () => void log.push("up"),
      scroll: async (a) => void log.push(`scroll ${a}`),
      type: async (t) => void log.push(`type ${t}`),
      press: async (k) => void log.push(`press ${k.join("+")}`),
      cursor: () => at,
      sleep: async () => undefined,
      cancelled: () => false,
      verify: async () => ({ ok: true }),
      ...over,
    };
    return { host, log, moveUser: (p: { x: number; y: number }) => (at = p) };
  };

  const plan = validateDrivePlan(
    {
      title: "Search",
      actions: [
        { kind: "click", x: 640, y: 360, why: "search box", expect: "box focused" },
        { kind: "type", text: "baton" },
        { kind: "press", keys: ["Enter"] },
        { kind: "drag", x: 0, y: 0, to_x: 10, to_y: 10, screen: 2 },
      ],
    },
    shots,
  );

  it("performs every step at desktop coordinates and checks the ones with expect", async () => {
    const verified: number[] = [];
    const { host, log } = fakeHost({
      verify: async (_a, i) => {
        verified.push(i);
        return { ok: true };
      },
    });
    expect(await runDrivePlan(plan, shots, host)).toEqual({ kind: "finished", steps: 4 });
    expect(log).toEqual([
      "move 854,480",
      "click left 1",
      "type baton",
      "press enter",
      "move 1707,0",
      "down",
      "move 1722,15",
      "up",
    ]);
    expect(verified).toEqual([0]);
  });

  it("stops when the check fails", async () => {
    const { host, log } = fakeHost({
      verify: async () => ({ ok: false, reason: "a popup opened" }),
    });
    expect(await runDrivePlan(plan, shots, host)).toEqual({
      kind: "stopped",
      step: 0,
      reason: "a popup opened",
    });
    expect(log).toEqual(["move 854,480", "click left 1"]);
  });

  it("stops when he takes the mouse", async () => {
    const ctl = fakeHost();
    ctl.host = {
      ...ctl.host,
      verify: async () => (ctl.moveUser({ x: 900, y: 900 }), { ok: true }),
    };
    const result = await runDrivePlan(plan, shots, ctl.host);
    expect(result).toEqual({
      kind: "stopped",
      step: 1,
      reason: "Stopped because you moved the mouse.",
    });
  });

  it("stops on cancel and never leaves the button held", async () => {
    let calls = 0;
    const { host, log } = fakeHost({
      cancelled: () => ++calls > 4,
      moveTo: async (p) => {
        log.push(`move ${p.x},${p.y}`);
        if (p.x > 1710) throw new Error("driver died");
      },
      cursor: () => ({ x: 1707, y: 0 }),
    });
    const dragOnly = validateDrivePlan(
      { title: "d", actions: [{ kind: "drag", x: 0, y: 0, to_x: 10, to_y: 10, screen: 2 }] },
      shots,
    );
    await expect(runDrivePlan(dragOnly, shots, host)).rejects.toThrow("driver died");
    expect(log.at(-1)).toBe("up");
  });
});

describe("parseScreenIntent", () => {
  it.each([
    ["what's this error?", "look"],
    ["look at my screen and tell me what's wrong", "look"],
    ["where is the export button", "look"],
    ["look: why is this red", "look"],
    ["teach me how to make a pivot table", "teach"],
    ["show me how to add a filter", "teach"],
    ["walk me through setting up a webhook", "teach"],
    ["how do I export this step by step", "teach"],
    ["drive: rename this file to final", "drive"],
    ["take over and fill in the form", "drive"],
    ["can you open the downloads folder for me", "drive"],
    ["do it for me", "drive"],
  ])("%s → %s", (text, kind) => {
    expect(parseScreenIntent(text, false)?.kind).toBe(kind);
  });

  it.each([
    "show me the scheduler session",
    "what needs me?",
    "tell it: run the tests",
    "start a session on VentureOS",
    "next",
  ])("leaves %s to Baton's grammar", (text) => {
    expect(parseScreenIntent(text, false)).toBeNull();
  });

  it("takes next, stop and repeat only while a lesson or drive runs", () => {
    expect(parseScreenIntent("next", true)).toEqual({ kind: "next" });
    expect(parseScreenIntent("I did it.", true)).toEqual({ kind: "next" });
    expect(parseScreenIntent("stop", true)).toEqual({ kind: "stop" });
    expect(parseScreenIntent("say that again", true)).toEqual({ kind: "repeat" });
    expect(parseScreenIntent("stop", false)).toBeNull();
  });
});

describe("pointing only at what it can vouch for", () => {
  it("reads confidence and refuses a low or missing one", () => {
    const sure = parseReply("There. [POINT:10,20:Save:screen2:0.9]").point;
    expect(sure).toMatchObject({ label: "Save", screen: 2, confidence: 0.9 });
    expect(pointable(sure)).toBe(true);
    expect(pointable(parseReply("Maybe. [POINT:10,20:Save:screen2:0.4]").point)).toBe(false);
    expect(pointable(parseReply("Old. [POINT:10,20:Save]").point)).toBe(false);
    expect(pointable(parseReply("I can't see one. [POINT:none]").point)).toBe(false);
  });
});

describe("needsCaptureApproval", () => {
  const base = { policy: "ask" as const, allowedUntil: 0, sessionApproved: false, now: 1000 };
  it("asks by default, and not inside an approved lesson, an hour's allowance, or always", () => {
    expect(needsCaptureApproval(base)).toBe(true);
    expect(needsCaptureApproval({ ...base, sessionApproved: true })).toBe(false);
    expect(needsCaptureApproval({ ...base, allowedUntil: 2000 })).toBe(false);
    expect(needsCaptureApproval({ ...base, policy: "always" })).toBe(false);
  });
});
